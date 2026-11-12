import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { sendAppleWalletPush } from "./apple-push.js";

import {
  getState,
  getBusiness,
  configureBusiness,
  createMember,
  findMember,
  findMemberByToken,
  awardVisit,
  redeemReward,
  deductPoints,
  registerAppleDevice,
  unregisterAppleDevice,
  getAppleDevices,
  updateMemberPromotion
} from "./store.js";

import {
  createGoogleSaveUrl,
  googleWalletReady,
  updateGoogleObject,
  sendGoogleWalletMessage
} from "./google-wallet.js";

import {
  appleWalletReady,
  generateApplePass
} from "./apple-wallet.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../public")));

const port = Number(process.env.PORT || 3000);
const APPLE_PASS_TYPE_ID = process.env.APPLE_PASS_TYPE_ID;

// --------------------------------------------------
// APPLE AUTHENTICATION
// --------------------------------------------------

function authenticateApplePass(req, res, member) {
  if (!member) {
    res.status(404).end();
    return false;
  }

  const authorization = req.headers.authorization || "";
  const expected = `ApplePass ${member.appleAuthToken}`;

  if (authorization !== expected) {
    res.status(401).end();
    return false;
  }

  return true;
}

// --------------------------------------------------
// STATE
// --------------------------------------------------

app.get("/api/state", (req, res) => {
  const state = getState();

  // Never expose Apple authentication tokens or device push tokens.
  const safeMembers = state.members.map((member) => {
    const {
      appleAuthToken,
      appleDevices,
      ...safeMember
    } = member;

    return {
      ...safeMember,
      appleDeviceCount: appleDevices?.length || 0
    };
  });

  res.json({
    ...state,
    members: safeMembers,
    integrations: {
      googleWallet: googleWalletReady(),
      appleWallet: appleWalletReady()
    }
  });
});

// --------------------------------------------------
// BUSINESS
// --------------------------------------------------

app.post("/api/business", (req, res) => {
  const business = configureBusiness(req.body || {});
  res.json({ business });
});

// --------------------------------------------------
// MEMBERS
// --------------------------------------------------

app.post("/api/members", async (req, res) => {
  if (!req.body?.name) {
    return res.status(400).json({ error: "Name is required" });
  }

  const member = createMember(req.body);
  const qrDataUrl = await QRCode.toDataURL(member.qrToken);

  res.status(201).json({ member, qrDataUrl });
});

app.get("/api/members/:id/qr-image", async (req, res) => {
  const member = findMember(req.params.id);

  if (!member) return res.status(404).end();

  const png = await QRCode.toBuffer(member.qrToken);
  res.type("png").send(png);
});

app.get("/api/members/:id/qr", async (req, res) => {
  const member = findMember(req.params.id);

  if (!member) {
    return res.status(404).json({ error: "Member not found" });
  }

  res.json({
    qrDataUrl: await QRCode.toDataURL(member.qrToken)
  });
});

// --------------------------------------------------
// SCAN / AWARD VISIT
// --------------------------------------------------

app.post("/api/scan", async (req, res) => {
  const member = findMemberByToken(req.body?.token);

  if (!member) {
    return res.status(404).json({ error: "QR not recognized" });
  }

  const updated = awardVisit(member.id);

  let walletUpdate = { skipped: true };

  try {
    walletUpdate = await updateGoogleObject(updated);
  } catch (e) {
    walletUpdate = { error: e.message };
  }

  res.json({
    member: updated,
    walletUpdate,
    rewardAvailable: updated.availableRewards > 0
  });
});

// --------------------------------------------------
// REDEEM REWARD
// --------------------------------------------------

app.post("/api/members/:id/redeem", async (req, res) => {
  try {
    const member = redeemReward(
      req.params.id,
      Boolean(req.body?.accept)
    );

    let walletUpdate = { skipped: true };

    try {
      walletUpdate = await updateGoogleObject(member);
    } catch (e) {
      walletUpdate = { error: e.message };
    }

    res.json({ member, walletUpdate });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --------------------------------------------------
// DEDUCT POINTS
// --------------------------------------------------

app.post("/api/members/:id/deduct-points", async (req, res) => {
  try {
    const member = deductPoints(
      req.params.id,
      req.body?.amount
    );

    let walletUpdate = { skipped: true };

    try {
      walletUpdate = await updateGoogleObject(member);
    } catch (e) {
      walletUpdate = { error: e.message };
    }

    res.json({ member, walletUpdate });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// --------------------------------------------------
// GOOGLE WALLET
// --------------------------------------------------

app.get("/api/members/:id/google-save", async (req, res) => {
  try {
    const member = findMember(req.params.id);

    if (!member) {
      return res.status(404).json({ error: "Member not found" });
    }

    res.json({
      url: await createGoogleSaveUrl(member)
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/members/:id/google-message", async (req, res) => {
  try {
    if (!googleWalletReady()) {
      return res.status(400).json({
        error: "Google Wallet is not configured"
      });
    }

    const member = findMember(req.params.id);

    if (!member) {
      return res.status(404).json({
        error: "Member not found"
      });
    }

    const { header, body } = req.body || {};

    if (
      typeof header !== "string" ||
      typeof body !== "string" ||
      !header.trim() ||
      !body.trim()
    ) {
      return res.status(400).json({
        error: "Both header and body are required"
      });
    }

    if (header.length > 60 || body.length > 500) {
      return res.status(400).json({
        error: "Header must be 60 characters or less and body 500 characters or less"
      });
    }

    const result = await sendGoogleWalletMessage(
      member,
      header.trim(),
      body.trim()
    );

    res.json({
      success: true,
      memberId: member.id,
      result
    });
  } catch (e) {
    console.error("Google Wallet message error:", e);
    res.status(500).json({ error: e.message });
  }
});

// --------------------------------------------------
// APPLE PASS DOWNLOAD
// --------------------------------------------------

app.get("/api/members/:id/apple-pass", async (req, res) => {
  try {
    const member = findMember(req.params.id);

    if (!member) {
      return res.status(404).json({
        error: "Member not found"
      });
    }

    const pass = await generateApplePass(member);

    res.type("application/vnd.apple.pkpass");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${member.id}.pkpass"`
    );

    res.send(pass.getAsBuffer());
  } catch (e) {
    console.error("Apple pass generation error:", e);
    res.status(400).send(e.message);
  }
});

// --------------------------------------------------
// APPLE WALLET WEB SERVICE
// --------------------------------------------------

// Register a device for a pass.
app.post(
  "/api/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
  (req, res) => {
    
    try {
      const {
        deviceLibraryIdentifier,
        passTypeIdentifier,
        serialNumber
      } = req.params;

      if (passTypeIdentifier !== APPLE_PASS_TYPE_ID) {
        return res.status(404).end();
      }

      const member = findMember(serialNumber);

      if (!authenticateApplePass(req, res, member)) return;

      const pushToken = req.body?.pushToken;

      if (typeof pushToken !== "string" || !pushToken) {
        return res.status(400).json({
          error: "Missing pushToken"
        });
      }

      const alreadyRegistered = getAppleDevices(member.id).some(
        (device) =>
          device.deviceLibraryIdentifier === deviceLibraryIdentifier
      );

      registerAppleDevice(
        member.id,
        deviceLibraryIdentifier,
        pushToken
      );

      return res.status(alreadyRegistered ? 200 : 201).end();
    } catch (e) {
      console.error("Apple device registration error:", e);
      return res.status(500).end();
    }
  }
);

// Check which passes on a device need updating.
// --------------------------------------------------
// APPLE WALLET: FIND UPDATED PASSES FOR A DEVICE
// --------------------------------------------------

app.get(
  "/api/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier",
  (req, res) => {
    try {
      const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;

      if (passTypeIdentifier !== APPLE_PASS_TYPE_ID) {
        return res.status(404).end();
      }

      const passesUpdatedSince = req.query.passesUpdatedSince;

      const updatedMembers = getState().members.filter((member) => {
        const registered = (member.appleDevices || []).some(
          (device) =>
            device.deviceLibraryIdentifier === deviceLibraryIdentifier
        );

        if (!registered || !member.applePassUpdatedAt) {
          return false;
        }

        if (!passesUpdatedSince) {
          return true;
        }

        return member.applePassUpdatedAt > passesUpdatedSince;
      });

      if (updatedMembers.length === 0) {
        return res.status(204).end();
      }

      const lastUpdated = new Date().toISOString();

      console.log("APPLE WALLET UPDATED PASSES:", {
        deviceLibraryIdentifier,
        serialNumbers: updatedMembers.map((member) => member.id)
      });

      return res.json({
        serialNumbers: updatedMembers.map((member) => member.id),
        lastUpdated
      });

    } catch (error) {
      console.error("Apple registration lookup error:", error);
      return res.status(500).end();
    }
  }
);

// Deliver the latest signed pass to Apple Wallet.
app.get(
  "/api/apple/v1/passes/:passTypeIdentifier/:serialNumber",
  async (req, res) => {
    console.log("APPLE WALLET FETCH:", {
      serialNumber: req.params.serialNumber,
      time: new Date().toISOString()
    });
    try {
      const { passTypeIdentifier, serialNumber } = req.params;

      if (passTypeIdentifier !== APPLE_PASS_TYPE_ID) {
        return res.status(404).end();
      }

      const member = findMember(serialNumber);

      if (!authenticateApplePass(req, res, member)) return;

      const pass = await generateApplePass(member);
      const buffer = pass.getAsBuffer();

      res.setHeader("Last-Modified", new Date().toUTCString());
      res.setHeader("Content-Type", "application/vnd.apple.pkpass");
      res.send(buffer);
    } catch (e) {
      console.error("Apple pass update error:", e);
      res.status(500).end();
    }
  }
);

// Unregister a device from a pass.
app.delete(
  "/api/apple/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
  (req, res) => {
    try {
      const {
        deviceLibraryIdentifier,
        passTypeIdentifier,
        serialNumber
      } = req.params;

      if (passTypeIdentifier !== APPLE_PASS_TYPE_ID) {
        return res.status(404).end();
      }

      const member = findMember(serialNumber);

      if (!authenticateApplePass(req, res, member)) return;

      unregisterAppleDevice(member.id, deviceLibraryIdentifier);

      res.status(200).end();
    } catch (e) {
      console.error("Apple device unregistration error:", e);
      res.status(500).end();
    }
  }
);

// Apple Wallet diagnostics endpoint.
app.post("/api/apple/v1/log", (req, res) => {
  console.log("Apple Wallet log:", req.body);
  res.status(200).end();
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(port, "0.0.0.0", () => {
  console.log(`Wallet POC running at http://localhost:${port}`);
});
// --------------------------------------------------
// APPLE WALLET PROMOTIONAL UPDATES
// --------------------------------------------------

app.post("/api/members/:id/apple-promotion", async (req, res) => {
  try {
    const { message } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "Promotion message is required."
      });
    }

    if (message.length > 200) {
      return res.status(400).json({
        error: "Promotion message cannot exceed 200 characters."
      });
    }

    const member = updateMemberPromotion(
      req.params.id,
      message
    );

    const devices = getAppleDevices(member.id);

    if (devices.length === 0) {
      return res.status(404).json({
        error: "No Apple Wallet devices registered."
      });
    }

    const results = await Promise.all(
      devices.map(async (device) => {
        try {
          const result = await sendAppleWalletPush(device.pushToken);

          return {
            success: true,
            deviceLibraryIdentifier: device.deviceLibraryIdentifier,
            ...result
          };
        } catch (error) {
          return {
            success: false,
            deviceLibraryIdentifier: device.deviceLibraryIdentifier,
            error: error.message
          };
        }
      })
    );

    res.json({
      success: results.every((result) => result.success),
      promotion: member.promoMessage,
      devicesNotified: results.filter((result) => result.success).length,
      totalDevices: devices.length,
      results
    });

  } catch (error) {
    console.error("Apple promotion error:", error);

    res.status(500).json({
      error: error.message
    });
  }
});