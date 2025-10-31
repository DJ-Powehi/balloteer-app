// backend/index.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Bot, InlineKeyboard } = require("grammy");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

// pega do db.js
const { query } = require("./db");

// endpoint que o bot usa no /join pra saber se o cara já logou no site
app.get("/api/telegram-user/:tgId", async (req, res) => {
  const tgId = req.params.tgId;
  try {
    const result = await query(
      "SELECT telegram_id, privy_id, wallet_address FROM users_telegram WHERE telegram_id = $1",
      [tgId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "not_found" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("error reading users_telegram", err);
    return res.status(500).json({ error: "db_error" });
  }
});

const {
  loadAllCommunities,
  upsertCommunity,
  upsertVoter,
  upsertProposal,
  updateProposalCounter,
} = require("./db");

// ===== IN-MEMORY CACHE (preenchido no boot pelo Postgres) =====
let communities = {};
let adminsCommunities = {};
const pendingCustomWeight = {};
const draftProposal = {};
const waitingMyVoteSelection = {};
const pendingSetWeight = {};

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 8080;
const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  "https://balloteer-app-production.up.railway.app";

if (!BOT_TOKEN) {
  throw new Error("❌ BOT_TOKEN missing (set BOT_TOKEN in Railway env vars)");
}

// create bot (webhook mode)
const bot = new Bot(BOT_TOKEN);

app.get("/api/telegram-user/:tgId", async (req, res) => {
  const tgId = req.params.tgId;
  const row = await pool.query(
    "SELECT telegram_id, privy_id, wallet_address FROM users_telegram WHERE telegram_id = $1",
    [tgId]
  );
  if (row.rows.length === 0) {
    return res.status(404).json({ error: "not_found" });
  }
  return res.json(row.rows[0]);
});


/**
CACHE SHAPE

communities[groupId] = {
  title: string,
  adminId: number,
  voters: {
    [userId]: {
      approved: boolean,
      weight: number | null,
      processed: boolean,
      username: string,
      walletAddress: string | null,
      lastChangeReason: string | null,
      lastModifiedAt: string | null,
    }
  },
  proposals: [{
    id: number,
    title: string,
    options: string[],
    votes: { [optionIdx]: totalWeight },
    voterMap: { [userId]: optionIdx },
    status: "open" | "closed",
    quorumWeight: number | null,
    endsAt: number | null,
    createdBy: number,
    attachmentFileId: string | null,
    attachmentFileName: string | null,
  }],
  proposalCounter: number,
}

adminsCommunities[adminId] = Map<groupId, { title: string }>
**/

// --------------------------------------------------
// UTILS
// --------------------------------------------------

// pega sempre o chatId certo (group ou DM)
function getChatId(ctx) {
  const chat =
    ctx.chat ||
    ctx.message?.chat ||
    ctx.update?.callback_query?.message?.chat;
  return chat ? chat.id : null;
}

// detecta se é chat privado
function isPrivateChat(ctx) {
  const t =
    ctx.chat?.type ||
    ctx.message?.chat?.type ||
    ctx.update?.callback_query?.message?.chat?.type;
  return t === "private";
}

// no bot/index.js (ou onde você registra comandos)
bot.command("link", async (ctx) => {
  const tgId = ctx.from.id; // id do telegram
  const baseUrl = "https://balloteer.xyz/login"; // sua página que já tem o privy
  const link = `${baseUrl}?tg_id=${tgId}`;

  await ctx.reply(
    "To connect your Telegram to Balloteer, open this link and login:",
    {
      reply_markup: {
        inline_keyboard: [[{ text: "Connect Balloteer", url: link }]],
      },
    }
  );
});

/**
 * ensureCommunityForGroupStart(...)
 * - usada SÓ dentro do /start quando o bot é adicionado num grupo
 * - se não existir ainda em memória, cria a comunidade
 * - também atualiza o título do grupo se mudou
 */
function ensureCommunityForGroupStart(groupId, titleMaybe) {
  if (!communities[groupId]) {
    communities[groupId] = {
      title: titleMaybe || `Community ${groupId}`,
      adminId: null,
      voters: {},
      proposals: [],
      proposalCounter: 1,
    };
  } else {
    if (titleMaybe && titleMaybe !== communities[groupId].title) {
      communities[groupId].title = titleMaybe;
    }
  }
  return communities[groupId];
}

/**
 * ensureCommunity(groupId)
 * - usada em fluxos tipo /join, etc
 * - NÃO cria comunidade nova "do nada"
 * - se não existir no cache, retorna null
 */
function ensureCommunity(groupId) {
  return communities[groupId] || null;
}

// liga admin ↔ comunidade (tabela lateral adminsCommunities)
function linkAdminToCommunity(adminId, groupId, title) {
  if (!adminsCommunities[adminId]) {
    adminsCommunities[adminId] = new Map();
  }
  adminsCommunities[adminId].set(groupId, { title });
}

// pega (ou inicializa) o registro do votante dentro da comunidade
function getOrInitVoterRecord(comm, fromUser) {
  const uid = fromUser.id;
  if (!comm.voters[uid]) {
    comm.voters[uid] = {
      approved: false,
      weight: null,
      processed: false,
      username: fromUser.username
        ? `@${fromUser.username}`
        : (fromUser.first_name || "Unknown"),
      walletAddress: null,
      lastChangeReason: null,
      lastModifiedAt: null,
    };
  } else {
    // atualiza display name
    comm.voters[uid].username = fromUser.username
      ? `@${fromUser.username}`
      : (fromUser.first_name || comm.voters[uid].username);

    if (comm.voters[uid].processed === undefined) {
      comm.voters[uid].processed = false;
    }
    if (comm.voters[uid].lastChangeReason === undefined) {
      comm.voters[uid].lastChangeReason = null;
    }
    if (comm.voters[uid].lastModifiedAt === undefined) {
      comm.voters[uid].lastModifiedAt = null;
    }
  }
  return comm.voters[uid];
}

// checa se userId é admin daquela comunidade
function isAdmin(comm, userId) {
  return comm.adminId !== null && comm.adminId === userId;
}

// desenha barrinha "███░░░"
function makeBar(pct) {
  const barLength = 10;
  const filledLen = Math.round((pct / 100) * barLength);
  return "█".repeat(filledLen) + "░".repeat(barLength - filledLen);
}

function calcTotalWeight(proposal) {
  let totalWeight = 0;
  for (const idx in proposal.votes) {
    totalWeight += proposal.votes[idx];
  }
  return totalWeight;
}

// decide quem ganhou / empate / zero votos
function calcWinnerInfo(proposal) {
  const total = calcTotalWeight(proposal);

  const weights = proposal.options.map((_, idx) => {
    return proposal.votes[idx] || 0;
  });

  let maxWeight = 0;
  weights.forEach((w) => {
    if (w > maxWeight) maxWeight = w;
  });

  const tiedIndexes = [];
  weights.forEach((w, idx) => {
    if (w === maxWeight) tiedIndexes.push(idx);
  });

  const breakdown = proposal.options.map((opt, idx) => {
    const w = weights[idx];
    const pct = total === 0 ? 0 : Math.round((w / total) * 100);
    return {
      label: opt,
      weight: w,
      pct,
    };
  });

  let outcomeType;
  let winnerIdx = null;
  let winnerPct = 0;

  if (total === 0) {
    outcomeType = "no_votes";
  } else if (tiedIndexes.length === 1) {
    outcomeType = "winner";
    winnerIdx = tiedIndexes[0];
    winnerPct = breakdown[winnerIdx].pct;
  } else {
    outcomeType = "tie";
  }

  return {
    outcomeType,
    winnerIdx,
    winnerPct,
    total,
    breakdown,
    tiedIndexes,
  };
}

function formatResultsSummaryForGroup(proposal) {
  const {
    outcomeType,
    winnerIdx,
    winnerPct,
    total,
    breakdown,
    tiedIndexes,
  } = calcWinnerInfo(proposal);

  const quorumReached =
    proposal.quorumWeight === null
      ? true
      : total >= proposal.quorumWeight;

  let headline;
  if (outcomeType === "no_votes") {
    headline =
      "No votes were cast. No outcome could be determined.";
  } else if (outcomeType === "tie") {
    const tiedLabels = tiedIndexes
      .map((i) => `"${proposal.options[i]}"`)
      .join(" and ");
    headline =
      `It’s a tie between ${tiedLabels}.\n` +
      "No single winner.";
  } else {
    const winnerLabel = proposal.options[winnerIdx];
    headline =
      `🥇 Winner: "${winnerLabel}" with ${winnerPct}% of total voting weight`;
  }

  const lines = breakdown
    .map(
      (b) =>
        `• ${b.label} — ${b.pct}% (${b.weight} weight)`
    )
    .join("\n");

  return (
    `🏁 Voting Closed for: "${proposal.title}"\n\n` +
    `${headline}\n\n` +
    `📊 Turnout: ${total} total weight\n` +
    (proposal.quorumWeight !== null
      ? `Quorum: ${
          quorumReached
            ? "✅ reached"
            : `⚠️ not reached (${total} < ${proposal.quorumWeight})`
        }\n`
      : "") +
    `\nFinal Breakdown:\n${lines}\n\n` +
    `🔒 This vote is now final.`
  );
}

function isProposalOpenForVoting(proposal) {
  if (proposal.status !== "open") return false;
  if (proposal.endsAt !== null && Date.now() > proposal.endsAt) {
    return false;
  }
  return true;
}

async function autoCloseExpiredProposals(groupId) {
  const comm = communities[groupId];
  if (!comm) return;

  for (const proposal of comm.proposals) {
    if (proposal.status === "open") {
      if (
        proposal.endsAt !== null &&
        Date.now() > proposal.endsAt
      ) {
        await finalizeProposal(comm, groupId, proposal);
      }
    }
  }
}

async function finalizeProposal(comm, groupId, proposal) {
  proposal.status = "closed";

  // salva no banco já fechado
  await upsertProposal(groupId, proposal);

  const finalMsg = formatResultsSummaryForGroup(proposal);

  try {
    await bot.api.sendMessage(groupId, finalMsg);
  } catch (e) {
    console.error("Failed to post final summary:", e);
  }
}

// mensagem privada pro votante
function formatProposalForDM(proposal, voterWeight) {
  const deadlineText = proposal.endsAt
    ? `Voting closes at: ${new Date(proposal.endsAt).toISOString()}\n`
    : "";
  const weightText =
    voterWeight != null
      ? `Your voting weight: ${voterWeight}\n`
      : "";
  return (
    `🗳 Proposal #${proposal.id}: "${proposal.title}"\n\n` +
    deadlineText +
    weightText +
    "Tap to cast or change your vote:\n"
  );
}

function buildVoteDMKeyboard(groupId, proposal) {
  const kb = new InlineKeyboard();
  proposal.options.forEach((opt, idx) => {
    kb
      .text(
        opt,
        `dmvote_${groupId}_${proposal.id}_${idx}`
      )
      .row();
  });
  return kb;
}

function buildMyVoteKeyboardForUser(userId) {
  const choices = [];
  for (const [gidStr, comm] of Object.entries(communities)) {
    const gid = Number(gidStr);
    const voter = comm.voters[userId];
    if (!voter || voter.approved !== true || !voter.weight) continue;

    for (const p of comm.proposals) {
      if (isProposalOpenForVoting(p)) {
        choices.push({
          groupId: gid,
          proposalId: p.id,
          title: p.title,
        });
      }
    }
  }

  if (choices.length === 0) {
    return null;
  }

  const kb = new InlineKeyboard();
  choices.forEach((c) => {
    kb.text(
      `#${c.proposalId} ${c.title}`,
      `myvote_${c.groupId}_${c.proposalId}`
    ).row();
  });

  return kb;
}

// helper de popup em callbackQuery
async function popup(ctx, text) {
  try {
    await ctx.answerCallbackQuery({
      text,
      show_alert: true,
    });
  } catch (e) {}
}


// --------------------------------------------------
// COMMANDS / CALLBACKS
// --------------------------------------------------

// /start
bot.command("start", async (ctx) => {
  const chatId = getChatId(ctx);
  if (chatId === null) return;

  if (!isPrivateChat(ctx)) {
    // GROUP / SUPERGROUP
    const groupTitle =
      ctx.chat?.title || `Community ${chatId}`;
    const comm = ensureCommunityForGroupStart(chatId, groupTitle);


    let justAssignedAdmin = false;
    if (comm.adminId === null) {
      comm.adminId = ctx.from.id;
      justAssignedAdmin = true;
    }


    linkAdminToCommunity(
      comm.adminId,
      chatId,
      comm.title
    );

    const voter = getOrInitVoterRecord(comm, ctx.from);
    // ⬅ ADD THIS: salva comunidade, contador inicial e o próprio admin como voter
    await upsertCommunity(chatId, comm.title, comm.adminId);
    await updateProposalCounter(chatId, comm.proposalCounter);
    await upsertVoter(chatId, ctx.from.id, comm.voters[ctx.from.id]);


    // [DB] persist admin como voter também

    await ctx.reply(
      "👋 Balloteer is now active in this community.\n\n" +
        "How it works:\n" +
        "• To request voting access: DM me (@" +
        bot.botInfo.username +
        ") and send /join\n" +
        "• You can only vote after the admin approves you\n" +
        "• When a new vote opens, I will DM eligible voters privately\n" +
        "• Final results will be posted here\n\n" +
        "If you didn’t get a DM from me yet, send /start in private."
    );

    if (justAssignedAdmin) {
      try {
        await bot.api.sendMessage(
          ctx.from.id,
          "You are ADMIN ✅ of \"" +
            comm.title +
            "\".\n\n" +
            "How to run this community:\n" +
            "• /new (DM) → Create a new proposal\n" +
            "  - I'll announce it in the group\n" +
            "  - I'll DM every approved voter privately so they can vote\n\n" +
            "• /close (DM) → Close an open proposal early\n" +
            "  - I'll post the final result in the group\n\n" +
            "• /join (voters run this in DM) → They request access\n" +
            "  - I DM you so you can approve and set weight\n\n" +
            "• /setweight (DM) → Adjust someone's voting weight later, with a reason\n\n" +
            "After approval, voters don't talk in the group. Voting is 100% private."
        );
      } catch (e) {
        // can't DM admin yet, that's fine
      }
    }

    return;
  }

  // PRIVATE / DM
  await ctx.reply(
    "👋 I'm Balloteer.\n\n" +
      "If you want permission to vote in a community:\n" +
      "• Send /join here in private.\n\n" +
      "If you are already approved and there's an active vote:\n" +
      "• I'll DM you automatically when a new vote opens.\n" +
      "• You can also run /myvote to review and (re)cast your vote.\n\n" +
      "If you're an admin:\n" +
      "• /new → create a proposal\n" +
      "• /close → end a proposal early\n" +
      "• /setweight → change someone's voting power (with reason)\n\n" +
      "The group only sees:\n" +
      "• new vote announcements\n" +
      "• final results\n" +
      "Voting itself is always private."
  );
});

// /join
bot.command("join", async (ctx) => {
  const chatId = getChatId(ctx);
  if (chatId === null) return;

  // 1) se não for DM, manda o cara ir pro DM
  if (!isPrivateChat(ctx)) {
    try {
      await bot.api.sendMessage(
        ctx.from.id,
        "To request voting access, please send /join here in private.\nI will notify the admin for approval."
      );
    } catch (e) {
      await ctx.reply(
        "Please DM me first @" + bot.botInfo.username + " and send /join."
      );
    }
    return;
  }

  // ---------------------------------------
  // 2) DM MESMO → primeiro checamos se já fez login na web (Privy)
  // ---------------------------------------
  const userId = ctx.from.id;
  const backendBase = process.env.BACKEND_URL; // <<< coloca no .env do bot

  let userFromBackend = null;
  try {
    const resp = await fetch(
      `${backendBase}/api/telegram-user/${userId}`
    );
    if (resp.ok) {
      userFromBackend = await resp.json();
    }
  } catch (err) {
    console.error("error checking privy user:", err);
  }

  // se não existe ou não tem wallet, barra aqui
  if (!userFromBackend || !userFromBackend.wallet_address) {
    const loginUrl = `https://balloteer.xyz/login?tg_id=${userId}`;
    await ctx.reply(
      "⚠️ You need to login on the web first so we can bind your Telegram to a wallet.\n" +
        "Click the link below, login with Telegram, and then come back here and send /join again:\n\n" +
        loginUrl
    );
    return;
  }

  // ---------------------------------------
  // 3) se chegou aqui → TEM WALLET → agora segue teu fluxo normal
  // ---------------------------------------
  const communityIds = Object.keys(communities).map(Number);

  if (communityIds.length === 0) {
    await ctx.reply(
      "There are no active communities yet.\nAsk an admin to /start me in a group first."
    );
    return;
  }

  let notifiedAnyAdmin = false;

  for (const gid of communityIds) {
    const comm = ensureCommunity(gid);
    if (!comm) continue;
    if (!comm.adminId) continue;

    // init voter record (processed=false so admin still needs to decide)
    const voter = getOrInitVoterRecord(comm, ctx.from);

    // 🔒 IMPORTANTE: já guarda a wallet que veio do backend
    voter.walletAddress = userFromBackend.wallet_address;
    voter.privyId = userFromBackend.privy_id || null;

    // [DB] persist estado atual do pedido
    await upsertVoter(gid, userId, voter);

    // se admin já marcou processed=true antes, não spam
    if (voter.processed === true) {
      continue;
    }

    const infoText =
      "🔔 New voter request:\n\n" +
      `Community: ${comm.title} (id ${gid})\n` +
      `Name: ${ctx.from.first_name || ""} ${ctx.from.last_name || ""}\n` +
      `Username: ${
        ctx.from.username ? "@" + ctx.from.username : "(no username)"
      }\n` +
      `Telegram ID: ${userId}\n` +
      `Wallet: ${userFromBackend.wallet_address}\n\n` +
      "Assign voting power:";

    const kb = new InlineKeyboard()
      .text("Approve (1 weight)", `approve_${gid}_${userId}_1`)
      .row()
      .text("Approve (3 weight)", `approve_${gid}_${userId}_3`)
      .row()
      .text("Approve (custom)", `custom_${gid}_${userId}`)
      .row()
      .text("Reject", `reject_${gid}_${userId}`);

    try {
      await bot.api.sendMessage(Number(comm.adminId), infoText, {
        reply_markup: kb,
      });
      notifiedAnyAdmin = true;
    } catch (e) {
      console.error("Failed to DM admin", comm.adminId, e);
    }
  }

  // ---------------------------------------
  // 4) mesma parte que você já tinha no final
  // ---------------------------------------
  let alreadyProcessedSomewhere = false;
  let alreadyApprovedSomewhere = false;

  for (const gid of communityIds) {
    const comm = communities[gid];
    if (!comm) continue;
    const v = comm.voters[userId];
    if (!v) continue;

    if (v.processed === true) {
      alreadyProcessedSomewhere = true;
      if (v.approved === true && v.weight > 0) {
        alreadyApprovedSomewhere = true;
      }
    }
  }

  if (notifiedAnyAdmin) {
    await ctx.reply(
      "✅ Your request was sent to the admin.\nYou'll get a DM if you're approved."
    );
  } else if (alreadyApprovedSomewhere) {
    await ctx.reply(
      "✅ You are already approved to vote in this community.\nUse /myvote to see active proposals."
    );
  } else if (alreadyProcessedSomewhere) {
    await ctx.reply(
      "❌ Your request was already reviewed by the admin.\nIf circumstances changed, ask the admin directly."
    );
  } else {
    await ctx.reply(
      "⚠️ I couldn't notify the admin (maybe they haven't DM'd me yet).\nAsk the admin to /start me in DM so I can message them."
    );
  }
});


// /new (DM admin only)
bot.command("new", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    await ctx.reply("Please run /new in a private chat with me.");
    return;
  }

  const adminId = ctx.from.id;
  const adminComms = adminsCommunities[adminId];
  if (!adminComms || adminComms.size === 0) {
    await ctx.reply(
      "You are not an admin of any community.\n" +
        "Add me to a group and run /start there first."
    );
    return;
  }

  draftProposal[adminId] = {
    step: "TITLE",
    title: "",
    options: [],
    quorumWeight: null,
    endsAt: null,
    attachmentFileId: null,
    attachmentFileName: null,
  };

  await ctx.reply(
    "📝 Proposal title?\n(Example: “Budget approval for Q4”)"
  );
});

// /close (DM admin only)
bot.command("close", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    await ctx.reply("Please run /close in a private chat with me.");
    return;
  }

  const adminId = ctx.from.id;
  const adminComms = adminsCommunities[adminId];
  if (!adminComms || adminComms.size === 0) {
    await ctx.reply("You don't administer any communities.");
    return;
  }

  const kb = new InlineKeyboard();
  let foundAny = false;

  for (const [gidStr, meta] of adminComms.entries()) {
    const gid = Number(gidStr);
    const comm = communities[gid];
    if (!comm) continue;
    if (!isAdmin(comm, adminId)) continue;

    await autoCloseExpiredProposals(gid);

    comm.proposals.forEach((p) => {
      if (isProposalOpenForVoting(p)) {
        foundAny = true;
        kb
          .text(
            `Close #${p.id} (${meta.title})`,
            `admclose_${gid}_${p.id}`
          )
          .row();
      }
    });
  }

  if (!foundAny) {
    await ctx.reply("No open proposals to close.");
    return;
  }

  await ctx.reply("Which proposal do you want to close now?", {
    reply_markup: kb,
  });
});

// admin clicked "close this proposal now"
bot.callbackQuery(/admclose_(-?\d+)_(-?\d+)/, async (ctx) => {
  const groupId = Number(ctx.match[1]);
  const proposalId = Number(ctx.match[2]);

  const comm = communities[groupId];
  if (!comm) {
    await popup(ctx, "Community not found.");
    return;
  }
  if (!isAdmin(comm, ctx.from.id)) {
    await popup(ctx, "Not authorized.");
    return;
  }

  await autoCloseExpiredProposals(groupId);

  const proposal = comm.proposals.find(
    (p) => p.id === proposalId
  );
  if (!proposal) {
    await popup(ctx, "Proposal not found.");
    return;
  }

  if (proposal.status === "closed") {
    await popup(ctx, "Already closed.");
    return;
  }

  await ctx.answerCallbackQuery({ text: "Closing..." });
  await finalizeProposal(comm, groupId, proposal);

  try {
    await bot.api.sendMessage(
      ctx.from.id,
      `🔒 Proposal #${proposal.id} (“${proposal.title}”) is now CLOSED.\n` +
        "Final result was posted in the group."
    );
  } catch (e) {}
});

// /myvote (DM user)
bot.command("myvote", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    await ctx.reply("Use /myvote here in DM with me.");
    return;
  }

  const txt = ctx.message.text.trim();
  const parts = txt.split(/\s+/);

  // user did /myvote <id>
  if (parts.length >= 2) {
    const proposalId = Number(parts[1]);
    if (isNaN(proposalId)) {
      await ctx.reply(
        "Usage:\n/myvote\nor\n/myvote <proposalId>"
      );
      return;
    }
    await handleMyVoteDetail(ctx, ctx.from.id, proposalId);
    return;
  }

  const kb = buildMyVoteKeyboardForUser(ctx.from.id);
  if (!kb) {
    await ctx.reply(
      "You currently have no open proposals to vote on.\n" +
        "If you believe there is an active vote but you didn't get a DM:\n" +
        "• Make sure you're approved (/join)\n" +
        "• Make sure you've talked to me in DM so I can message you."
    );
    return;
  }

  waitingMyVoteSelection[ctx.from.id] = true;
  await ctx.reply(
    "Which active vote do you want to review or change?",
    { reply_markup: kb }
  );
});

bot.callbackQuery(/myvote_(-?\d+)_(-?\d+)/, async (ctx) => {
  const groupId = Number(ctx.match[1]);
  const proposalId = Number(ctx.match[2]);
  const userId = ctx.from.id;

  if (!waitingMyVoteSelection[userId]) {
    await popup(ctx, "Please run /myvote in DM first.");
    return;
  }

  await ctx.answerCallbackQuery();
  await handleMyVoteDetail(ctx, userId, proposalId);
});

async function handleMyVoteDetail(ctx, userId, proposalId) {
  let foundComm = null;
  let foundProposal = null;
  let foundGroupId = null;

  for (const [gidStr, comm] of Object.entries(communities)) {
    const gid = Number(gidStr);

    const voter = comm.voters[userId];
    if (!voter || voter.approved !== true || !voter.weight) continue;

    const p = comm.proposals.find((x) => x.id === proposalId);
    if (!p) continue;

    foundComm = comm;
    foundProposal = p;
    foundGroupId = gid;
    break;
  }

  if (!foundProposal) {
    await ctx.reply(
      "I couldn't find an active proposal with that ID for you."
    );
    return;
  }

  await autoCloseExpiredProposals(foundGroupId);

  if (
    foundProposal.status === "closed" ||
    !isProposalOpenForVoting(foundProposal)
  ) {
    await ctx.reply(
      "This proposal is closed and can no longer be viewed or changed here."
    );
    return;
  }

  const voter = foundComm.voters[userId];
  const weight = voter.weight || 0;
  const currentIdx = foundProposal.voterMap[userId];
  const hasVoted = currentIdx !== undefined;
  const currentChoice = hasVoted
    ? foundProposal.options[currentIdx]
    : "(no vote yet)";

  const kb = new InlineKeyboard();
  foundProposal.options.forEach((opt, idx) => {
    kb
      .text(
        opt,
        `dmvote_${foundGroupId}_${foundProposal.id}_${idx}`
      )
      .row();
  });

  await ctx.reply(
    `Proposal #${foundProposal.id}: "${foundProposal.title}"\n` +
      `Your current vote: ${currentChoice}\n` +
      `Your weight: ${weight}\n\n` +
      `Tap below to cast or change your vote:`,
    { reply_markup: kb }
  );
}

// voting in DM (user taps option button)
bot.callbackQuery(/dmvote_(-?\d+)_(-?\d+)_(\d+)/, async (ctx) => {
  const groupId = Number(ctx.match[1]);
  const proposalId = Number(ctx.match[2]);
  const optionIdx = Number(ctx.match[3]);
  const userId = ctx.from.id;

  const comm = communities[groupId];
  if (!comm) {
    await popup(ctx, "Community not found.");
    return;
  }

  await autoCloseExpiredProposals(groupId);

  const proposal = comm.proposals.find(
    (x) => x.id === proposalId
  );
  if (!proposal) {
    await popup(ctx, "Proposal not found.");
    return;
  }

  if (
    proposal.status === "closed" ||
    !isProposalOpenForVoting(proposal)
  ) {
    await popup(ctx, "Voting is closed.");
    return;
  }

  const voter = comm.voters[userId];
  if (!voter || voter.approved !== true || !voter.weight) {
    await popup(
      ctx,
      "You’re not approved to vote in this community.\nSend /join in DM to request access."
    );
    return;
  }

  // remove previous vote weight if changing vote
  if (proposal.voterMap[userId] !== undefined) {
    const oldIdx = proposal.voterMap[userId];
    proposal.votes[oldIdx] =
      (proposal.votes[oldIdx] || 0) - voter.weight;
    if (proposal.votes[oldIdx] < 0) proposal.votes[oldIdx] = 0;
  }

  // apply new vote
  proposal.voterMap[userId] = optionIdx;
  proposal.votes[optionIdx] =
    (proposal.votes[optionIdx] || 0) + voter.weight;

  // [DB] salvar proposta atualizada (inclui votos e voterMap)
  await upsertProposal(groupId, proposal);

  await ctx.answerCallbackQuery({
    text: "✅ Vote counted",
    show_alert: false,
  });

  try {
    await bot.api.sendMessage(
      userId,
      "✅ Your vote has been recorded.\n" +
        `Proposal: "${proposal.title}" (ID ${proposal.id})\n` +
        `Choice: [ HIDDEN ]\n` +
        `Weight: ${voter.weight}\n\n` +
        "You can change your vote with /myvote " +
        proposal.id +
        " until the deadline."
    );
  } catch (e) {}
});

// legacy safety: don't leak live results before close
bot.callbackQuery(/dmresults_(-?\d+)_(-?\d+)/, async (ctx) => {
  const groupId = Number(ctx.match[1]);
  const proposalId = Number(ctx.match[2]);

  const comm = communities[groupId];
  if (!comm) {
    await popup(ctx, "Community not found.");
    return;
  }

  await autoCloseExpiredProposals(groupId);

  const proposal = comm.proposals.find(
    (x) => x.id === proposalId
  );
  if (!proposal) {
    await popup(ctx, "Proposal not found.");
    return;
  }

  if (proposal.status === "open" && isProposalOpenForVoting(proposal)) {
    await popup(ctx, "Results are hidden until voting ends.");
    return;
  }

  const totalWeight = calcTotalWeight(proposal);
  const lines = proposal.options.map((opt, idx) => {
    const w = proposal.votes[idx] || 0;
    const pct =
      totalWeight === 0
        ? 0
        : Math.round((w / totalWeight) * 100);
    return (
      `• ${opt}\n` +
      `  Weight: ${w} (${pct}%) ${makeBar(pct)}`
    );
  });

  const quorumText =
    proposal.quorumWeight !== null
      ? `Required quorum: ${proposal.quorumWeight}\n`
      : "";

  const endsText =
    proposal.endsAt !== null
      ? `Voting closed at: ${new Date(
          proposal.endsAt
        ).toISOString()}\n`
      : "";

  const summary =
    `📈 Final Results for Proposal #${proposal.id}\n` +
    `"${proposal.title}"\n🔒 CLOSED\n\n` +
    lines.join("\n\n") +
    `\n\nTotal voting weight: ${totalWeight}\n` +
    quorumText +
    endsText;

  await ctx.answerCallbackQuery();
  try {
    await bot.api.sendMessage(ctx.from.id, summary);
  } catch (e) {}
});

// /setweight (DM admin only) — interactive flow
bot.command("setweight", async (ctx) => {
  if (!isPrivateChat(ctx)) {
    await ctx.reply("Please run /setweight in a private chat with me.");
    return;
  }

  const adminId = ctx.from.id;
  const adminComms = adminsCommunities[adminId];

  if (!adminComms || adminComms.size === 0) {
    await ctx.reply(
      "You don't administer any communities.\n" +
        "Add me to a group and /start there first."
    );
    return;
  }

  pendingSetWeight[adminId] = {
    step: "CHOOSE_COMMUNITY",
    groupId: null,
    targetUserId: null,
    newWeight: null,
  };

  const kb = new InlineKeyboard();
  for (const [gid, meta] of adminComms.entries()) {
    kb.text(meta.title, `sw_comm_${gid}`).row();
  }

  await ctx.reply(
    "Which community do you want to manage?",
    { reply_markup: kb }
  );
});

// admin picked community in /setweight
bot.callbackQuery(/sw_comm_(-?\d+)/, async (ctx) => {
  const adminId = ctx.from.id;
  const groupId = Number(ctx.match[1]);

  const flow = pendingSetWeight[adminId];
  if (!flow || flow.step !== "CHOOSE_COMMUNITY") {
    await popup(ctx, "No active /setweight flow. Run /setweight again.");
    return;
  }

  const comm = communities[groupId];
  if (!comm) {
    await popup(ctx, "Community not found.");
    return;
  }
  if (!isAdmin(comm, adminId)) {
    await popup(ctx, "You are not admin of this community.");
    return;
  }

  flow.groupId = groupId;
  flow.step = "CHOOSE_USER";

  const kb = new InlineKeyboard();
  let foundAny = false;
  for (const [uidStr, voter] of Object.entries(comm.voters)) {
    const uid = Number(uidStr);
    if (voter.approved === true && voter.weight !== null) {
      foundAny = true;
      const label = `${voter.username || ("user " + uid)} (wt ${voter.weight})`;
      kb.text(label, `sw_user_${uid}`).row();
    }
  }

  await ctx.answerCallbackQuery();

  if (!foundAny) {
    await bot.api.sendMessage(
      adminId,
      `No approved voters found in "${comm.title}".`
    );
    delete pendingSetWeight[adminId];
    return;
  }

  await bot.api.sendMessage(
    adminId,
    `Who do you want to update in "${comm.title}"?`,
    { reply_markup: kb }
  );
});

// admin picked specific user in /setweight
bot.callbackQuery(/sw_user_(-?\d+)/, async (ctx) => {
  const adminId = ctx.from.id;
  const targetUserId = Number(ctx.match[1]);

  const flow = pendingSetWeight[adminId];
  if (!flow || flow.step !== "CHOOSE_USER") {
    await popup(ctx, "No active /setweight flow. Run /setweight again.");
    return;
  }

  const groupId = flow.groupId;
  const comm = communities[groupId];
  if (!comm) {
    await popup(ctx, "Community not found.");
    delete pendingSetWeight[adminId];
    return;
  }
  if (!isAdmin(comm, adminId)) {
    await popup(ctx, "Not authorized.");
    delete pendingSetWeight[adminId];
    return;
  }

  const voter = comm.voters[targetUserId];
  if (!voter || voter.approved !== true || voter.weight === null) {
    await popup(ctx, "That user is not an approved voter.");
    delete pendingSetWeight[adminId];
    return;
  }

  flow.targetUserId = targetUserId;
  flow.step = "ASK_WEIGHT";

  await ctx.answerCallbackQuery();

  await bot.api.sendMessage(
    adminId,
    `Current weight for ${voter.username || targetUserId} in "${comm.title}" is ${voter.weight}.\n\n` +
      "Please send the NEW weight as a positive number (e.g. 5)."
  );
});

// on("message"): handle 3 interactive flows (/setweight, approval custom, /new)
bot.on("message", async (ctx) => {
  const isDoc = !!ctx.message?.document;
  const isText = typeof ctx.message?.text === "string";
  const privateChat = isPrivateChat(ctx);
  const fromId = ctx.from?.id;
  if (!fromId) return;

  // (A) /setweight flow
  if (privateChat && pendingSetWeight[fromId]) {
    const flow = pendingSetWeight[fromId];

    // ASK_WEIGHT
    if (flow.step === "ASK_WEIGHT" && isText) {
      const newWeight = parseInt(ctx.message.text.trim(), 10);
      if (isNaN(newWeight) || newWeight <= 0) {
        await ctx.reply(
          "Weight must be a positive number. Try again.\nExample: 5"
        );
        return;
      }

      flow.newWeight = newWeight;
      flow.step = "ASK_REASON";

      await ctx.reply(
        "Reason for this change?\n" +
          "Example: promotion, left the project, reduced activity\n\n" +
          "If you don't want to record a note, reply with: skip"
      );
      return;
    }

    // ASK_REASON
    if (flow.step === "ASK_REASON" && isText) {
      const reasonTextRaw = ctx.message.text.trim();
      const reasonText =
        reasonTextRaw.toLowerCase() === "skip"
          ? "unspecified"
          : reasonTextRaw;

      const { groupId, targetUserId, newWeight } = flow;
      const comm = communities[groupId];
      if (!comm || !isAdmin(comm, fromId)) {
        await ctx.reply("Community/admin mismatch. Flow cancelled.");
        delete pendingSetWeight[fromId];
        return;
      }

      const voter = comm.voters[targetUserId];
      if (!voter) {
        await ctx.reply("Voter not found anymore. Flow cancelled.");
        delete pendingSetWeight[fromId];
        return;
      }

      voter.approved = true;
      voter.weight = newWeight;
      voter.processed = true; // already reviewed
      voter.lastChangeReason = reasonText;
      voter.lastModifiedAt = new Date().toISOString();

      // [DB] persist ajuste de peso
      await upsertVoter(groupId, targetUserId, voter);

      delete pendingSetWeight[fromId];

      await ctx.reply(
        `✅ Updated ${voter.username || targetUserId} in "${comm.title}".\n` +
          `New weight: ${newWeight}\n` +
          `Reason: ${reasonText}`
      );

      try {
        await bot.api.sendMessage(
          targetUserId,
          `ℹ️ Your voting weight in "${comm.title}" was updated.\n` +
            `New weight: ${newWeight}\n` +
            `Reason: ${reasonText}`
        );
      } catch (e) {}
      return;
    }
  }

  // (B) first-time custom approval flow
  if (isText && pendingCustomWeight[fromId]) {
    const { groupId, targetUserId } = pendingCustomWeight[fromId];
    const comm = communities[groupId];
    if (!comm || !isAdmin(comm, fromId)) {
      delete pendingCustomWeight[fromId];
    } else {
      const wNum = parseInt(ctx.message.text.trim(), 10);
      if (!isNaN(wNum) && wNum > 0) {
        const voter = comm.voters[targetUserId];
        if (voter) {
          if (voter.processed === true) {
            await ctx.reply(
              "Already processed. Use /setweight to change later."
            );
            delete pendingCustomWeight[fromId];
            return;
          }

          voter.approved = true;
          voter.weight = wNum;
          voter.processed = true;
          voter.walletAddress = voter.walletAddress || null;
          voter.lastChangeReason = "initial approval (custom weight)";
          voter.lastModifiedAt = new Date().toISOString();

          // [DB] persist aprovação custom
          await upsertVoter(groupId, targetUserId, voter);

          await ctx.reply(
            `✅ Approved ${voter.username} (ID ${targetUserId}) in "${comm.title}" with custom weight ${wNum}.`
          );

          try {
            await bot.api.sendMessage(
              targetUserId,
              `🎉 You are approved to vote in "${comm.title}".\n` +
                `Your voting weight: ${wNum}\n` +
                `Reason: initial approval (custom weight)\n\n` +
                "When a new vote opens, I'll DM you privately so you can vote.\n" +
                "You don't need to speak in the group.\n" +
                "Use /myvote (in DM) to review or change your vote while it's open."
            );
          } catch (e) {}
        } else {
          await ctx.reply("User not found in that community.");
        }
        delete pendingCustomWeight[fromId];
        return;
      } else {
        await ctx.reply(
          "Weight must be a positive number, e.g. 5. Try again."
        );
        return;
      }
    }
  }

  // (C) /new draftProposal flow
  if (privateChat && draftProposal[fromId]) {
    const draft = draftProposal[fromId];

    // TITLE
    if (draft.step === "TITLE" && isText) {
      draft.title = ctx.message.text.trim();
      draft.step = "OPTIONS";
      await ctx.reply(
        "Great. Now send the voting options.\n" +
          "Format: option1, option2, option3\n\n" +
          "Example:\nPizza, Sushi, Burger"
      );
      return;
    }

    // OPTIONS
    if (draft.step === "OPTIONS" && isText) {
      const cleaned = ctx.message.text
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);

      if (cleaned.length < 2) {
        await ctx.reply(
          "You need at least 2 options.\nExample:\nPizza, Sushi, Burger"
        );
        return;
      }

      draft.options = cleaned;
      draft.step = "QUORUM";
      await ctx.reply(
        "Quorum requirement?\n" +
          "Send the minimum total voting weight required for this vote to be valid.\n" +
          "Example: 30\n" +
          "Or type 'skip' to allow any turnout."
      );
      return;
    }

    // QUORUM
    if (draft.step === "QUORUM" && isText) {
      const txt = ctx.message.text.trim().toLowerCase();
      if (txt === "skip") {
        draft.quorumWeight = null;
      } else {
        const qNum = parseInt(txt, 10);
        if (isNaN(qNum) || qNum <= 0) {
          await ctx.reply(
            "Quorum must be a positive number or 'skip'. Try again."
          );
          return;
        }
        draft.quorumWeight = qNum;
      }

      draft.step = "DURATION";
      await ctx.reply(
        "Voting duration (in minutes)?\n" +
          "Example: 60\n" +
          "After this time, I will auto-close and announce the result in the group."
      );
      return;
    }

    // DURATION
    if (draft.step === "DURATION" && isText) {
      const durMin = parseInt(ctx.message.text.trim(), 10);
      if (isNaN(durMin) || durMin <= 0) {
        await ctx.reply(
          "Duration must be a positive number in minutes. Try again."
        );
        return;
      }

      const now = Date.now();
      draft.endsAt = now + durMin * 60 * 1000;
      draft.step = "ATTACHMENT";
      await ctx.reply(
        "Attach a reference file (PDF, spreadsheet, etc.)?\n" +
          "Send the file now, or type 'skip'."
      );
      return;
    }

    // ATTACHMENT
    if (draft.step === "ATTACHMENT") {
      if (isDoc) {
        draft.attachmentFileId = ctx.message.document.file_id;
        draft.attachmentFileName =
          ctx.message.document.file_name || null;
        draft.step = "CHOOSE_COMMUNITY";
      } else if (
        isText &&
        ctx.message.text.trim().toLowerCase() === "skip"
      ) {
        draft.attachmentFileId = null;
        draft.attachmentFileName = null;
        draft.step = "CHOOSE_COMMUNITY";
      } else {
        await ctx.reply(
          "Please either send a file to attach, or type 'skip'."
        );
        return;
      }

      const adminComms = adminsCommunities[fromId];
      if (!adminComms || adminComms.size === 0) {
        await ctx.reply(
          "You are not admin of any community.\n" +
            "Add me to a group and run /start there first."
        );
        delete draftProposal[fromId];
        return;
      }

      const kb = new InlineKeyboard();
      for (const [gid, meta] of adminComms.entries()) {
        kb
          .text(
            `Publish to: ${meta.title}`,
            `publish_${gid}`
          )
          .row();
      }

      await ctx.reply(
        "Which community should receive this proposal?",
        { reply_markup: kb }
      );
      return;
    }
  }
});

// finalize publish_<groupId> for /new
bot.callbackQuery(/publish_(-?\d+)/, async (ctx) => {
  const groupId = Number(ctx.match[1]);
  const adminId = ctx.from.id;

  const comm = communities[groupId];
  if (!comm) {
    await popup(ctx, "Community not found.");
    return;
  }
  if (!isAdmin(comm, adminId)) {
    await popup(ctx, "Not authorized.");
    return;
  }

  const draft = draftProposal[adminId];
  if (!draft || draft.step !== "CHOOSE_COMMUNITY") {
    await popup(ctx, "No active draft to publish.");
    return;
  }

  const newProposal = {
    id: comm.proposalCounter++,
    title: draft.title,
    options: draft.options,
    votes: {},        // { "0": totalWeight }
    voterMap: {},     // { "userId": optionIdx }
    status: "open",
    quorumWeight: draft.quorumWeight,
    endsAt: draft.endsAt,
    createdBy: adminId,
    attachmentFileId: draft.attachmentFileId,
    attachmentFileName: draft.attachmentFileName,
  };

  comm.proposals.push(newProposal);
  // limpamos o draft em memória
  delete draftProposal[adminId];

  // ⬅ ADD THIS
  await upsertProposal(groupId, newProposal);
  await updateProposalCounter(groupId, comm.proposalCounter);


  await ctx.answerCallbackQuery({ text: "Published!" });

  // 1. post attachment in the group if present
  if (newProposal.attachmentFileId) {
    try {
      await bot.api.sendDocument(groupId, newProposal.attachmentFileId, {
        caption:
          `📎 Reference for Proposal #${newProposal.id}: "${newProposal.title}"\n` +
          (newProposal.attachmentFileName
            ? `(${newProposal.attachmentFileName})`
            : ""),
      });
    } catch (e) {
      console.error("Failed to send attachment:", e);
    }
  }

  // 2. announce in the group
  const announcementText =
    `🗳 Voting is now OPEN: "${newProposal.title}"\n\n` +
    newProposal.options
      .map((opt, idx) => `• ${idx + 1}. ${opt}`)
      .join("\n") +
    "\n\n" +
    (newProposal.endsAt
      ? "⏳ Closes at: " +
        new Date(newProposal.endsAt).toISOString() +
        "\n"
      : "") +
    (newProposal.quorumWeight !== null
      ? `Quorum required: ${newProposal.quorumWeight} total weight\n`
      : "") +
    "\nHow to vote:\n" +
    "• I am sending a private message to eligible voters now.\n" +
    "• If you did NOT receive a DM from me:\n" +
    "  - Open a private chat with @" +
    bot.botInfo.username +
    "\n" +
    "  - Send /start, then /join if needed.\n" +
    "  - Then run /myvote.\n\n" +
    "Final results will be posted here when voting closes.";

  try {
    await bot.api.sendMessage(groupId, announcementText);
  } catch (e) {
    console.error("Failed to announce proposal in group:", e);
  }

  // 3. DM all approved voters with private ballot
  for (const [uidStr, voter] of Object.entries(comm.voters)) {
    const uid = Number(uidStr);
    if (!voter.approved || !voter.weight) continue;

    const introDM =
      formatProposalForDM(newProposal, voter.weight);

    try {
      await bot.api.sendMessage(uid, introDM, {
        reply_markup: buildVoteDMKeyboard(groupId, newProposal),
      });
    } catch (e) {
      // user never /start'd me, can't DM them. fine.
    }
  }

  // 4. DM admin confirmation
  try {
    await bot.api.sendMessage(
      adminId,
      "✅ Proposal created and published to \"" +
        comm.title +
        "\".\n\n" +
        "I announced it in the group and DM'ed all approved voters I can reach.\n" +
        "They vote privately.\n" +
        "When the deadline hits (or you /close), I'll post final results in the group."
    );
  } catch (e) {}
});

// global catch (so container doesn't crash on Telegram weirdness)
bot.catch((err) => {
  console.error("Bot error:", err);
});

// --------------------------------------------------
// EXPRESS + WEBHOOK SERVER
// --------------------------------------------------

// Telegram will POST updates here
app.post("/telegram/webhook", async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error in webhook handler:", err);
    res.sendStatus(500);
  }
});

// healthcheck
app.get("/", (req, res) => {
  res.status(200).send("Balloteer bot is running ✅");
});

// startup
(async () => {
    // init bot info (importante pro webhook mode porque usamos bot.botInfo.username)
    await bot.init();
  
    // 1. carrega comunidades / voters / proposals do Postgres
    const bootData = await loadAllCommunities();
    communities = bootData.communities;
    adminsCommunities = bootData.adminsCommunities;
    console.log("adminsCommunities keys =", Object.keys(adminsCommunities));
    console.log("💾 Loaded from DB:", Object.keys(communities));
  
    const server = app.listen(PORT, async () => {
      console.log(`🚀 API listening on port ${PORT}`);
  
      try {
        // clear old webhook & drop_pending_updates so a gente não pega backlog do polling
        await bot.api.deleteWebhook({ drop_pending_updates: true });
  
        // registra o webhook no Telegram
        await bot.api.setWebhook(`${PUBLIC_URL}/telegram/webhook`);
  
        console.log("📡 Webhook registered at", `${PUBLIC_URL}/telegram/webhook`);
        console.log(
          "✅ Balloteer bot running with:\n" +
            "- private voting only\n" +
            "- DM onboarding\n" +
            "- admin-only /new, /close, /setweight\n" +
            "- quorum + deadline + auto-close\n" +
            "- tie/no-vote handling in results\n" +
            "- per-voter weights with justification\n" +
            "- blocked repeat approvals\n" +
            "- DM notifications to users when weight changes\n" +
            "- 🔄 Postgres persistence (communities, voters, proposals)"
        );
      } catch (err) {
        console.error("❌ Failed to set webhook:", err);
      }
    });
  
    // IMPORTANTE: NÃO chamar bot.start()
    // bot.start() é só pra long polling, não pra webhook.
  })();
  
