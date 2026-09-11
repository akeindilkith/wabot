const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("baileys");

const P = require("pino");
const QRCode = require("qrcode");
const express = require("express");
const fs = require("fs");
const path = require("path");
const Fuse = require("fuse.js");

const FILES = path.join(__dirname, "files");

// =========================
// QR WEB SERVER
// =========================

const app = express();
const PORT = process.env.PORT || 3000;

let currentQR = null;

app.get("/", (req, res) => {
  if (!currentQR) {
    return res.send(`
      <h2>WhatsApp Bot</h2>
      <p>QR code is not available yet.</p>
      <p>Check again in a few seconds.</p>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>WhatsApp Bot QR</title>
      <style>
        body {
          font-family: Arial;
          text-align: center;
          background: #f5f5f5;
          padding: 30px;
        }

        .box {
          background: white;
          max-width: 400px;
          margin: auto;
          padding: 25px;
          border-radius: 20px;
          box-shadow: 0 5px 25px rgba(0,0,0,.15);
        }

        img {
          width: 100%;
          max-width: 350px;
        }
      </style>
    </head>

    <body>
      <div class="box">
        <h2>📱 Link WhatsApp</h2>
        <p>Open WhatsApp → Linked devices → Link a device</p>
        <img src="${currentQR}">
        <p>Scan this QR code</p>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`QR server running on port ${PORT}`);
});

// =========================
// COMMANDS
// =========================

const commands = [
  {
    names: [
      "price list",
      "pricelist",
      "price",
      "prices",
      "pricelist pdf"
    ],
    files: ["pricelist.pdf"],
    type: "document"
  },

  {
    names: ["rack", "racks", "rack photo", "rack image"],
    files: ["rack.jpeg"],
    type: "image"
  },

  {
    names: ["shutters 1", "shutter 1", "shutters1", "shutter1"],
    files: ["s11.jpeg", "s12.jpeg"],
    type: "image"
  },

  {
    names: ["shutters 2", "shutter 2", "shutters2", "shutter2"],
    files: ["s21.jpeg", "s22.jpeg"],
    type: "image"
  },

  {
    names: ["orange", "orange photo", "orange image"],
    files: ["orange.jpeg"],
    type: "image"
  }
];

// =========================
// CLEAN MESSAGE
// =========================

function clean(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

// =========================
// FUZZY SEARCH
// =========================

const fuse = new Fuse(
  commands.flatMap(command =>
    command.names.map(name => ({
      name,
      command
    }))
  ),
  {
    keys: ["name"],
    threshold: 0.45
  }
);

function findCommand(text) {
  const result = fuse.search(clean(text));

  if (result.length === 0) {
    return null;
  }

  return result[0].item.command;
}

// =========================
// SEND FILES
// =========================

async function sendCommand(sock, jid, command) {

  for (const filename of command.files) {

    const filePath = path.join(FILES, filename);

    if (!fs.existsSync(filePath)) {
      console.log("Missing file:", filePath);
      continue;
    }

    if (command.type === "document") {

      await sock.sendMessage(jid, {
        document: fs.readFileSync(filePath),
        mimetype: "application/pdf",
        fileName: filename
      });

    } else if (command.type === "image") {

      await sock.sendMessage(jid, {
        image: fs.readFileSync(filePath)
      });

    }
  }
}

// =========================
// START WHATSAPP
// =========================

async function startBot() {

  const { state, saveCreds } =
    await useMultiFileAuthState("./auth");

  const { version } =
    await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on(
    "connection.update",
    ({ connection, lastDisconnect, qr }) => {

      if (qr) {

        console.log("New WhatsApp QR generated.");

        QRCode.toDataURL(qr, (err, url) => {

          if (err) {
            console.error("QR generation error:", err);
            return;
          }

          currentQR = url;

          console.log(
            "Open the service URL in your browser to scan the QR."
          );
        });
      }

      if (connection === "open") {

        currentQR = null;

        console.log("\n✅ BOT CONNECTED!\n");
      }

      if (connection === "close") {

        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;

        console.log("Connection closed.");

        if (shouldReconnect) {

          console.log("Reconnecting...");

          setTimeout(() => {
            startBot();
          }, 3000);

        } else {

          console.log(
            "❌ Logged out. Delete auth folder and login again."
          );
        }
      }
    }
  );

  // =========================
  // INCOMING MESSAGES
  // =========================

  sock.ev.on("messages.upsert", async ({ messages }) => {

    const msg = messages[0];

    if (!msg.message) return;
    if (msg.key.fromMe) return;

    const jid = msg.key.remoteJid;

    if (jid.endsWith("@g.us")) return;

    const message =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!message) return;

    console.log("User:", message);

    const command = findCommand(message);

    if (!command) {

      console.log("No matching command.");
      return;
    }

    console.log(
      "Matched:",
      command.names[0]
    );

    try {

      await sendCommand(
        sock,
        jid,
        command
      );

      console.log("✅ Files sent.");

    } catch (error) {

      console.error(
        "Send error:",
        error
      );
    }
  });
}

startBot();