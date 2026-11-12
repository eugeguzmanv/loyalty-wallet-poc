import fs from "node:fs";
import http2 from "node:http2";
import path from "node:path";

const projectRoot = process.cwd();

function resolvePath(envVariable, fallback) {
  return path.resolve(projectRoot, process.env[envVariable] || fallback);
}

const certificatePath = resolvePath(
  "APPLE_SIGNER_CERT",
  "credentials/apple/pass-cert.pem"
);

const privateKeyPath = resolvePath(
  "APPLE_SIGNER_KEY",
  "credentials/apple/pass-private-key.pem"
);

const APNS_HOST = "https://api.push.apple.com";

function getApnsCredentials() {
  if (!fs.existsSync(certificatePath)) {
    throw new Error("Apple Pass Type ID certificate not found.");
  }

  if (!fs.existsSync(privateKeyPath)) {
    throw new Error("Apple Pass Type ID private key not found.");
  }

  return {
    cert: fs.readFileSync(certificatePath),
    key: fs.readFileSync(privateKeyPath)
  };
}

/**
 * Sends an empty APNs push to notify Apple Wallet
 * that a registered pass needs to be refreshed.
 *
 * The actual promotional content is delivered later
 * when Wallet fetches the updated .pkpass.
 */
export function sendAppleWalletPush(pushToken) {
  if (typeof pushToken !== "string" || !pushToken.trim()) {
    throw new Error("A valid APNs push token is required.");
  }

  const { cert, key } = getApnsCredentials();

  return new Promise((resolve, reject) => {
    const client = http2.connect(APNS_HOST, {
      cert,
      key,
      ALPNProtocols: ["h2"]
    });

    let settled = false;

    function finish(error, result) {
      if (settled) return;
      settled = true;
      client.close();

      if (error) reject(error);
      else resolve(result);
    }

    client.on("error", (error) => finish(error));

    client.on("connect", () => {
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${pushToken}`,
        "apns-topic": process.env.APPLE_PASS_TYPE_ID,
        "apns-push-type": "background",
        "apns-priority": "5",
        "content-type": "application/json"
      });

      let responseStatus;
      let responseBody = "";

      request.on("response", (headers) => {
        responseStatus = headers[":status"];
      });

      request.on("data", (chunk) => {
        responseBody += chunk.toString();
      });

      request.on("end", () => {
        if (responseStatus === 200) {
          finish(null, {
            success: true,
            status: responseStatus
          });
        } else {
          finish(new Error(
            `APNs rejected the push: HTTP ${responseStatus} ${responseBody}`
          ));
        }
      });

      request.on("error", (error) => finish(error));

      // Wallet update pushes use an empty JSON payload.
      request.end("{}");
    });
  });
}