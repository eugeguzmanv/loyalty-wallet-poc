import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import { createSign } from "node:crypto";
import { getBusiness, setGoogleObjectId } from "./store.js";

function credentials() {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "./credentials/google-service-account.json";
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
export function googleWalletReady() {
  return Boolean(process.env.GOOGLE_ISSUER_ID && credentials());
}
function authClient() {
  const c = credentials();
  if (!c) throw new Error("Google service account JSON not found");
  return new google.auth.JWT({
    email: c.client_email,
    key: c.private_key,
    scopes: ["https://www.googleapis.com/auth/wallet_object.issuer"]
  });
}
function ids(member) {
  const issuer = process.env.GOOGLE_ISSUER_ID;
  const suffix = (member.id || "").replaceAll("-", "_");
  const classSuffix = process.env.GOOGLE_CLASS_SUFFIX || "loyalty_demo";
  return { classId: `${issuer}.${classSuffix}`, objectId: `${issuer}.${suffix}` };
}
export async function createGoogleSaveUrl(member) {
  if (!googleWalletReady()) throw new Error("Google Wallet credentials are not configured");
  const c = credentials();
  const business = getBusiness();
  const { classId, objectId } = ids(member);
  const auth = authClient();
  const wallet = google.walletobjects({ version: "v1", auth });
  try {
    await wallet.loyaltyclass.get({ resourceId: classId });
  } catch {
    await wallet.loyaltyclass.insert({
      requestBody: {
        id: classId,
        issuerName: business?.name || "Demo Business",
        programName: business?.name || "Loyalty",
        programLogo: {
          sourceUri: {
            uri: "https://placehold.co/660x660/png?text=Loyalty+POC"
          }
        },
        reviewStatus: "UNDER_REVIEW"
      }
    });
  }
  const points = business?.programType === "points";
  const object = {
    id: objectId,
    classId,
    state: "ACTIVE",
    accountId: member.id,
    accountName: member.name,
    barcode: { type: "QR_CODE", value: member.qrToken, alternateText: "Escanea en el negocio" },
    loyaltyPoints: {
      label: points ? "Puntos" : "Sellos",
      balance: { string: points ? String(member.points) : `${member.stamps}/${business?.stampThreshold || 8}` }
    }
  };
  try {
    await wallet.loyaltyobject.get({ resourceId: objectId });
    await wallet.loyaltyobject.update({ resourceId: objectId, requestBody: object });
  } catch {
    await wallet.loyaltyobject.insert({ requestBody: object });
  }
  setGoogleObjectId(member.id, objectId);
  const payload = {
    iss: c.client_email,
    aud: "google",
    origins: [process.env.BASE_URL || "http://localhost:3000"],
    typ: "savetowallet",
    payload: { loyaltyObjects: [object] }
  };
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${header}.${body}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(c.private_key).toString("base64url");
  return `https://pay.google.com/gp/v/save/${unsigned}.${signature}`;
}
export async function updateGoogleObject(member) {
  if (!googleWalletReady() || !member.googleObjectId) {
    return { skipped: true };
  }

  const business = getBusiness();
  const auth = authClient();

  const wallet = google.walletobjects({
    version: "v1",
    auth
  });

  const points = business?.programType === "points";

  await wallet.loyaltyobject.patch({
    resourceId: member.googleObjectId,
    requestBody: {
      loyaltyPoints: {
        label: points ? "Puntos" : "Sellos",
        balance: {
          string: points
            ? String(member.points)
            : `${member.stamps}/${business?.stampThreshold || 8}`
        }
      },
      notifyPreference: "notifyOnUpdate"
    }
  });

  return { updated: true };
}
export async function sendGoogleWalletMessage(member, header, body) {
  if (!googleWalletReady() || !member.googleObjectId) {
    return { skipped: true };
  }

  const auth = authClient();

  const wallet = google.walletobjects({
    version: "v1",
    auth
  });

  const messageId = `msg_${Date.now()}`;

  const response = await wallet.loyaltyobject.addmessage({
    resourceId: member.googleObjectId,
    requestBody: {
      message: {
        id: messageId,
        header,
        body,
        messageType: "TEXT_AND_NOTIFY"
      }
    }
  });

  return {
    sent: true,
    messageId,
    response: response.data
  };
}