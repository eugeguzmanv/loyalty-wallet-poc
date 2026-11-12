import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, "../data/db.json");

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { business: null, members: [], events: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }

  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

let db = load();

// Add Apple Wallet properties to existing members that predate this change.
let migrated = false;

for (const member of db.members) {
  if (!member.appleAuthToken) {
    member.appleAuthToken = randomBytes(32).toString("hex");
    migrated = true;
  }

  if (!Object.hasOwn(member, "applePassUpdatedAt")) {
    member.applePassUpdatedAt = null;
    migrated = true;
  }

  if (!Array.isArray(member.appleDevices)) {
    member.appleDevices = [];
    migrated = true;
  }
}

if (migrated) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

export function getState() {
  return structuredClone(db);
}

export function getBusiness() {
  return db.business;
}

export function configureBusiness(input) {
  db.business = {
    id: db.business?.id ?? randomUUID(),
    name: input.name || "Demo Coffee",
    programType: input.programType === "points" ? "points" : "stamps",
    stampThreshold: Math.max(2, Number(input.stampThreshold) || 8),
    pointsPerVisit: Math.max(1, Number(input.pointsPerVisit) || 10),
    updatedAt: new Date().toISOString()
  };

  save();
  return db.business;
}

export function createMember({ name, phone }) {
  const member = {
    id: randomUUID(),
    name: String(name || "Guest").trim().slice(0, 80),
    phone: String(phone || "").trim().slice(0, 30),
    qrToken: randomBytes(24).toString("base64url"),

    stamps: 0,
    availableRewards: 0,
    points: 0,

    createdAt: new Date().toISOString(),

    // Google Wallet
    googleObjectId: null,

    // Apple Wallet
    appleAuthToken: randomBytes(32).toString("hex"),
    applePassUpdatedAt: null,
    appleDevices: []
  };

  db.members.push(member);
  save();

  return member;
}

export function findMemberByToken(token) {
  return db.members.find(m => m.qrToken === token);
}

export function findMember(id) {
  return db.members.find(m => m.id === id);
}

export function setGoogleObjectId(memberId, objectId) {
  const member = findMember(memberId);

  if (!member) return;

  member.googleObjectId = objectId;
  save();
}

export function recordEvent(type, member, details = {}) {
  const event = {
    id: randomUUID(),
    type,
    memberId: member.id,
    details,
    createdAt: new Date().toISOString()
  };

  db.events.push(event);
  save();

  return event;
}

export function awardVisit(memberId) {
  const member = findMember(memberId);

  if (!member) {
    throw new Error("Member not found");
  }

  const business = db.business;

  if (business.programType === "points") {
    member.points += business.pointsPerVisit;

    recordEvent("points_awarded", member, {
      amount: business.pointsPerVisit
    });
  } else {
    member.stamps += 1;

    if (member.stamps >= business.stampThreshold) {
      member.stamps -= business.stampThreshold;
      member.availableRewards += 1;

      recordEvent("stamp_reward_earned", member, {
        threshold: business.stampThreshold
      });
    }

    recordEvent("stamp_awarded", member, {
      amount: 1
    });
  }

  save();
  return member;
}

export function redeemReward(memberId, accept) {
  const member = findMember(memberId);

  if (!member) {
    throw new Error("Member not found");
  }

  if (member.availableRewards < 1) {
    throw new Error("No available reward");
  }

  if (accept) {
    member.availableRewards -= 1;
    recordEvent("reward_redeemed", member);
  } else {
    recordEvent("reward_redemption_declined", member);
  }

  save();
  return member;
}

export function deductPoints(memberId, amount) {
  const member = findMember(memberId);
  const n = Math.floor(Number(amount));

  if (!member) {
    throw new Error("Member not found");
  }

  if (!Number.isInteger(n) || n <= 0 || n > member.points) {
    throw new Error("Invalid points deduction");
  }

  member.points -= n;

  recordEvent("points_deducted", member, {
    amount: n
  });

  save();
  return member;
}
// --------------------------------------------------
// APPLE WALLET DEVICE REGISTRATION
// --------------------------------------------------

export function registerAppleDevice(
  memberId,
  deviceLibraryIdentifier,
  pushToken
) {
  const member = findMember(memberId);

  if (!member) {
    throw new Error("Member not found");
  }

  if (!Array.isArray(member.appleDevices)) {
    member.appleDevices = [];
  }

  const existing = member.appleDevices.find(
    (device) =>
      device.deviceLibraryIdentifier === deviceLibraryIdentifier
  );

  if (existing) {
    existing.pushToken = pushToken;
    existing.updatedAt = new Date().toISOString();
  } else {
    member.appleDevices.push({
      deviceLibraryIdentifier,
      pushToken,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  save();
  return member;
}

export function unregisterAppleDevice(
  memberId,
  deviceLibraryIdentifier
) {
  const member = findMember(memberId);

  if (!member) {
    throw new Error("Member not found");
  }

  member.appleDevices = (member.appleDevices || []).filter(
    (device) =>
      device.deviceLibraryIdentifier !== deviceLibraryIdentifier
  );

  save();
  return member;
}

export function getAppleDevices(memberId) {
  const member = findMember(memberId);
  return member?.appleDevices || [];
}

// --------------------------------------------------
// APPLE WALLET PROMOTIONS
// --------------------------------------------------

export function updateMemberPromotion(memberId, message) {
  const member = findMember(memberId);

  if (!member) {
    throw new Error("Member not found");
  }

  member.promoMessage = String(message).trim().slice(0, 200);
  member.applePassUpdatedAt = new Date().toISOString();

  recordEvent("apple_promotion_updated", member, {
    message: member.promoMessage
  });

  save();

  return member;
}