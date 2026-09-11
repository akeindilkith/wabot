const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("baileys");

const P = require("pino");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");
const Fuse = require("fuse.js");

const FILES = path.join(__dirname, "files");

// Commands and acceptable variations
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

// Clean user's message
function clean(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

// Find command using fuzzy matching
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

async function startBot() {

  const { state, saveCreds } =
    await useMultiFileAuthState("./auth");

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" }),
    printQRInTerminal: false
  });

  // Save login information
  sock.ev.on("creds.update", saveCreds);

  // Connection handling
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {

    if (qr) {
      console.log("\nSCAN THIS QR WITH WHATSAPP:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("\n✅ BOT CONNECTED!");
    }

    if (connection === "close") {

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      console.log("Connection closed.");

      if (shouldReconnect) {
        console.log("Reconnecting...");
        startBot();
      } else {
        console.log("❌ Logged out. Delete auth folder and login again.");
      }
    }
  });

  // Incoming messages
  sock.ev.on("messages.upsert", async ({ messages }) => {

    const msg = messages[0];

    if (!msg.message) return;
    if (msg.key.fromMe) return;

    const jid = msg.key.remoteJid;

    // Ignore groups
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

      await sendCommand(sock, jid, command);

      console.log("✅ Files sent.");

    } catch (error) {

      console.error("Send error:", error);

    }
  });
}

startBot();