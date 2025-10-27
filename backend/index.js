// backend/index.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");

// -------------------------
// 1. Express API
// -------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

// endpoint simples só pra testar deploy
app.get("/", (req, res) => {
  res.send("Balloteer backend online ✅");
});

// pega a porta do Railway ou 3000 local
const PORT = process.env.PORT || 3000;

// -------------------------
// 2. Telegram bot
// -------------------------
const { Bot, InlineKeyboard } = require("grammy");

// segurança básica pra não crashar se não tiver token em prod ainda
if (!process.env.BOT_TOKEN) {
  console.warn("⚠️ BOT_TOKEN is missing. Bot will not start.");
} else {
  const bot = new Bot(process.env.BOT_TOKEN);

  // aqui você pode colar o mesmo código do bot que já testamos
  bot.command("ping", (ctx) => ctx.reply("pong 🏓"));

  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  bot.start();
  console.log("🤖 Telegram bot started");
}

// -------------------------
// 3. Start HTTP server
// -------------------------
app.listen(PORT, () => {
  console.log(`🚀 API listening on port ${PORT}`);
});
