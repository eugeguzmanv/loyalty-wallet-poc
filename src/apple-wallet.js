import fs from "node:fs";
import path from "node:path";
import { PKPass } from "passkit-generator";
import { getBusiness } from "./store.js";

// --------------------------------------------------
// CONFIGURATION
// --------------------------------------------------

const projectRoot = process.cwd();

function resolvePath(envVariable, fallback) {
  return path.resolve(projectRoot, process.env[envVariable] || fallback);
}

const certificatePaths = {
  wwdr: () => resolvePath("APPLE_WWDR_CERT", "credentials/apple/wwdr.pem"),
  signerCert: () => resolvePath("APPLE_SIGNER_CERT", "credentials/apple/pass-cert.pem"),
  signerKey: () => resolvePath("APPLE_SIGNER_KEY", "credentials/apple/pass-private-key.pem")
};

const modelPath = path.resolve(projectRoot, "assets/apple-pass");

function getBaseUrl() {
  const url = process.env.BASE_URL;

  if (!url) {
    throw new Error("BASE_URL is required for Apple Wallet updates.");
  }

  return url.replace(/\/+$/, "");
}

// --------------------------------------------------
// READINESS CHECK
// --------------------------------------------------

export function appleWalletReady() {
  const hasIdentifiers =
    Boolean(process.env.APPLE_PASS_TYPE_ID) &&
    Boolean(process.env.APPLE_TEAM_ID);

  const hasCertificates = [
    certificatePaths.wwdr(),
    certificatePaths.signerCert(),
    certificatePaths.signerKey()
  ].every((filePath) => fs.existsSync(filePath));

  return hasIdentifiers && hasCertificates;
}

// --------------------------------------------------
// GENERATE APPLE WALLET PASS
// --------------------------------------------------

export async function generateApplePass(member) {
  if (!appleWalletReady()) {
    throw new Error("Apple Wallet signing credentials are missing or invalid.");
  }

  const business = getBusiness();

  if (!business) {
    throw new Error("Business configuration not found.");
  }

  if (!member?.id || !member?.qrToken || !member?.appleAuthToken) {
    throw new Error("Invalid member information or missing Apple authentication token.");
  }

  const points = business.programType === "points";

  const certificates = {
    wwdr: fs.readFileSync(certificatePaths.wwdr()),
    signerCert: fs.readFileSync(certificatePaths.signerCert()),
    signerKey: fs.readFileSync(certificatePaths.signerKey()),
    signerKeyPassphrase: process.env.APPLE_SIGNER_KEY_PASSPHRASE || undefined
  };

  const pass = await PKPass.from(
    {
      model: modelPath,
      certificates
    },
    {
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID,
      teamIdentifier: process.env.APPLE_TEAM_ID,
      serialNumber: member.id,

      organizationName:
        process.env.APPLE_ORGANIZATION_NAME ||
        business.name ||
        "bitvox",

      description: `${business.name} loyalty membership`,

      backgroundColor: "rgb(16, 24, 43)",
      foregroundColor: "rgb(255, 255, 255)",
      labelColor: "rgb(180, 194, 216)",

      // Apple Wallet Web Service
      webServiceURL: `${getBaseUrl()}/api/apple`,
      authenticationToken: member.appleAuthToken
    }
  );

  // ------------------------------------------------
  // CUSTOMER QR CODE
  // ------------------------------------------------

  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: member.qrToken,
    messageEncoding: "iso-8859-1",
    altText: "Escanea en el negocio"
  });

  // ------------------------------------------------
  // LOYALTY INFORMATION
  // ------------------------------------------------

  pass.primaryFields.push({
    key: "balance",
    label: points ? "PUNTOS" : "SELLOS",
    value: points
      ? String(member.points)
      : `${member.stamps}/${business.stampThreshold || 8}`
  });

  pass.secondaryFields.push({
    key: "rewards",
    label: "RECOMPENSAS",
    value: String(member.availableRewards)
  });

  pass.auxiliaryFields.push({
    key: "member",
    label: "SOCIO",
    value: member.name
  });

  // ------------------------------------------------
  // PROMOTIONAL FIELD
  // ------------------------------------------------

  pass.backFields.push({
    key: "promo",
    label: "PROMOCIÓN",
    value: member.promoMessage || "Sin promociones activas",
    changeMessage: "Nueva promoción: %@"
  });

  return pass;
}