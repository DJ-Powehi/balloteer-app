// backend/index.js
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { Bot, InlineKeyboard } = require("grammy");

// ====== ENV VARS ======
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 8080;
const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  "https://balloteer-app-production.up.railway.app";

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing in .env / Railway variables");
  process.exit(1);
}

// ====== IN-MEMORY STATE ======
// IMPORTANTE: isso zera quando reinicia o container. Depois vamos trocar pra Postgres.
const state = {
  groups: {}, // groupId -> { title, adminId, proposals: [proposalId,...], members: { userId: {weight, approved} } }
  proposals: {}, // proposalId -> { ...dadosDaProposta }
  nextProposalId: 1,
  pendingJoinRequests: {}, // groupId -> [ { userId, name } ]
  pendingWeightChange: {}, // adminId -> { step, groupId, targetUserId, newWeight, reason }
  userPrivateState: {}, // userId -> { step: "...", draftProposal: {...} }
};

// ====== CREATE BOT (webhook mode) ======
const bot = new Bot(BOT_TOKEN);

// helper: get group name
function groupName(chat) {
  if (!chat) return "(unknown group)";
  return chat.title || chat.username || `(group ${chat.id})`;
}

// helper: build results text (public-safe)
function buildResultsSummary(proposal) {
  const totalWeight = Object.values(proposal.votes).reduce(
    (acc, v) => acc + v.weight,
    0
  );

  let breakdownLines = [];
  let topWeight = 0;
  let winners = [];
  proposal.options.forEach((opt, idx) => {
    const w = proposal.tally[idx] || 0;
    const pct = totalWeight === 0 ? 0 : Math.round((w / totalWeight) * 100);
    breakdownLines.push(`${opt}: ${w} (${pct}%)`);
    if (w > topWeight) {
      topWeight = w;
      winners = [opt];
    } else if (w === topWeight) {
      winners.push(opt);
    }
  });

  let statusLine;
  if (totalWeight === 0) {
    statusLine = "No votes were recorded.";
  } else if (winners.length > 1) {
    statusLine = `It's a tie between: ${winners.join(" vs ")}`;
  } else {
    const winOpt = winners[0];
    const winIdx = proposal.options.indexOf(winOpt);
    const winPct =
      totalWeight === 0
        ? 0
        : Math.round((proposal.tally[winIdx] / totalWeight) * 100);
    statusLine = `${winOpt} won with ${winPct}% of the voting power.`;
  }

  return (
    `🗳 ${proposal.title}\n\n` +
    breakdownLines.map((l) => "• " + l).join("\n") +
    `\n\nTotal voting weight: ${totalWeight}\n\n` +
    `🏁 Result: ${statusLine}`
  );
}

// helper: is proposal still active?
function isProposalOpen(p) {
  const now = Date.now();
  if (p.closedManually) return false;
  if (now >= p.endsAt) return false;
  return true;
}

// helper: did quorum hit?
function quorumReached(p, group) {
  // regra exemplo:
  // - 2 pessoas distintas votaram, OU
  // - pelo menos 50% do peso total elegível votou
  const votersWhoVoted = new Set(Object.keys(p.votes));
  if (votersWhoVoted.size >= 2) return true;

  let totalPossibleWeight = 0;
  let votedWeight = 0;
  for (const uid in group.members) {
    if (group.members[uid].approved && group.members[uid].weight > 0) {
      totalPossibleWeight += group.members[uid].weight;
    }
  }
  for (const uid of votersWhoVoted) {
    votedWeight += p.votes[uid].weight;
  }
  if (totalPossibleWeight === 0) return false;
  const pct = (votedWeight / totalPossibleWeight) * 100;
  return pct >= 50;
}

// helper: close proposal if needed
async function maybeCloseProposal(bot, proposalId) {
  const p = state.proposals[proposalId];
  if (!p) return;

  const grp = state.groups[p.groupId];
  if (!grp) return;

  const now = Date.now();
  const expired = now >= p.endsAt;
  const quorumHit = quorumReached(p, grp);

  if ((expired || quorumHit) && !p.closedAt) {
    // close it
    p.closedAt = new Date().toISOString();
    p.closedManually = expired ? false : true;

    // announce final result in the group
    const summary = buildResultsSummary(p);

    try {
      await bot.api.sendMessage(
        p.groupId,
        `🔒 Voting closed.\n\n${summary}`
      );
    } catch (err) {
      console.error("Failed to announce close in group:", err.message);
    }
  }
}

// helper: only admin?
function isAdminOfGroup(userId, groupId) {
  const g = state.groups[groupId];
  if (!g) return false;
  return g.adminId === userId;
}

// ====== BOT COMMANDS ======

// /start in private DM OR group
bot.command("start", async (ctx) => {
  const chat = ctx.chat;
  const user = ctx.from;

  if (chat.type === "private") {
    await ctx.reply(
      "👋 Welcome to Balloteer.\n\n" +
        "• To request access to vote in a community, send /join here and pick the community.\n" +
        "• Admins will approve you and assign a voting weight.\n\n" +
        "Admins can run:\n" +
        "• /new – create a new vote\n" +
        "• /close – close a vote early\n" +
        "• /setweight – change someone's voting weight\n" +
        "• /approve – review join requests"
    );
    return;
  }

  // group chat case
  if (!state.groups[chat.id]) {
    state.groups[chat.id] = {
      title: chat.title || chat.username || `group ${chat.id}`,
      adminId: user.id, // first /start user becomes admin
      proposals: [],
      members: {}, // userId -> { approved: bool, weight: number }
    };
  }

  const g = state.groups[chat.id];

  const groupMsg =
    "👋 Balloteer is now active in this community.\n\n" +
    "How it works:\n" +
    "• To request voting access: DM me and send /join\n" +
    "• You can only vote after the admin approves you\n" +
    "• Voting happens in private DM so the group stays clean\n";

  try {
    await ctx.reply(groupMsg);
  } catch (err) {
    console.error("Failed to send group /start msg:", err.message);
  }

  // tell that user privately they are admin
  if (g.adminId === user.id) {
    try {
      await bot.api.sendMessage(
        user.id,
        "✅ You are ADMIN of " +
          (g.title || chat.id) +
          ".\n\n" +
          "Use:\n" +
          "• /new to create a vote\n" +
          "• /close to end a vote\n" +
          "• /setweight to edit weights\n" +
          "• /approve to handle join requests\n" +
          "All flows happen here in DM."
      );
    } catch (err) {
      console.error("Couldn't DM admin:", err.message);
    }
  }
});

// /join MUST be in DM
bot.command("join", async (ctx) => {
  const chat = ctx.chat;
  const user = ctx.from;
  if (chat.type !== "private") {
    await ctx.reply("📩 DM me and run /join there.");
    return;
  }

  // Build list of communities
  const groupEntries = Object.entries(state.groups);
  if (groupEntries.length === 0) {
    await ctx.reply(
      "There are no communities registered yet. Ask your admin to run /start in the group first."
    );
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const [gid, g] of groupEntries) {
    keyboard.text(g.title || gid, `reqjoin_${gid}`).row();
  }

  await ctx.reply("Which community do you want to join?", {
    reply_markup: keyboard,
  });
});

// handle join request selection
bot.callbackQuery(/^reqjoin_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const user = ctx.from;
  const groupId = ctx.match[1];

  const g = state.groups[groupId];
  if (!g) {
    await ctx.reply("That community no longer exists.");
    return;
  }

  if (!state.pendingJoinRequests[groupId]) {
    state.pendingJoinRequests[groupId] = [];
  }

  const alreadyPending = state.pendingJoinRequests[groupId].some(
    (r) => r.userId === user.id
  );
  const alreadyApproved =
    g.members[user.id] && g.members[user.id].approved === true;

  if (alreadyApproved) {
    await ctx.reply(
      `You're already approved in "${g.title}". You'll get future ballots in DM.`
    );
    return;
  }

  if (!alreadyPending) {
    state.pendingJoinRequests[groupId].push({
      userId: user.id,
      name: `${user.first_name || ""} ${user.last_name || ""}`.trim(),
    });
  }

  await ctx.reply(
    `⏳ Request sent to the admin of "${g.title}". We'll DM you when you're approved.`
  );

  // ping admin with summary
  try {
    const reqList = state.pendingJoinRequests[groupId]
      .map(
        (r) =>
          `• ${r.name} (@${user.username || "no username"}) [${r.userId}]`
      )
      .join("\n");

    await bot.api.sendMessage(
      g.adminId,
      `👤 New join request(s) for "${g.title}":\n\n${reqList}\n\n` +
        "Use /approve to review and assign weights."
    );
  } catch (err) {
    console.error("Failed to DM admin about join request:", err.message);
  }
});

// /approve (admin, DM)
bot.command("approve", async (ctx) => {
  const chat = ctx.chat;
  const admin = ctx.from;
  if (chat.type !== "private") return;

  const adminGroups = Object.entries(state.groups).filter(
    ([gid, g]) => g.adminId === admin.id
  );
  if (adminGroups.length === 0) {
    await ctx.reply("You don't administer any communities.");
    return;
  }

  const kb = new InlineKeyboard();
  for (const [gid, g] of adminGroups) {
    const pending = state.pendingJoinRequests[gid]
      ? state.pendingJoinRequests[gid].length
      : 0;
    kb.text(`${g.title} (${pending} pending)`, `pickgroup_${gid}`).row();
  }

  await ctx.reply("Which community do you want to review?", {
    reply_markup: kb,
  });
});

// admin picked a group in /approve
bot.callbackQuery(/^pickgroup_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const admin = ctx.from;
  const groupId = ctx.match[1];
  const g = state.groups[groupId];
  if (!g || g.adminId !== admin.id) {
    await ctx.reply("You are not admin of that community.");
    return;
  }

  const pend = state.pendingJoinRequests[groupId] || [];
  if (pend.length === 0) {
    await ctx.reply("No pending join requests for this community.");
    return;
  }

  for (const req of pend) {
    const kb = new InlineKeyboard()
      .text("✅ Approve", `approveuser_${groupId}_${req.userId}`)
      .text("❌ Deny", `denyuser_${groupId}_${req.userId}`);

    await ctx.reply(
      `Request:\n` +
        `Name: ${req.name}\n` +
        `Telegram ID: ${req.userId}\n\n` +
        `Default weight will be 1. You can change via /setweight.\n`,
      { reply_markup: kb }
    );
  }
});

// admin taps Approve
bot.callbackQuery(/^approveuser_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const admin = ctx.from;
  const groupId = ctx.match[1];
  const targetId = ctx.match[2];

  const g = state.groups[groupId];
  if (!g || g.adminId !== admin.id) {
    await ctx.reply("You are not admin of that community.");
    return;
  }

  // remove from pending
  const list = state.pendingJoinRequests[groupId] || [];
  const idx = list.findIndex((r) => String(r.userId) === String(targetId));
  if (idx >= 0) {
    list.splice(idx, 1);
  }

  if (!g.members[targetId]) {
    g.members[targetId] = { approved: true, weight: 1 };
  } else {
    if (!g.members[targetId].approved) {
      g.members[targetId].approved = true;
      if (!g.members[targetId].weight) g.members[targetId].weight = 1;
    }
  }

  await ctx.reply(
    `✅ Approved user ${targetId} in "${g.title}".\nDefault weight = 1.\nUse /setweight to change.`
  );

  try {
    await bot.api.sendMessage(
      targetId,
      `🎉 You are approved to vote in "${g.title}".\n` +
        "You'll receive voting prompts in your DM for future proposals."
    );
  } catch (err) {
    console.error("Couldn't DM approved user:", err.message);
  }
});

// admin taps Deny
bot.callbackQuery(/^denyuser_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const admin = ctx.from;
  const groupId = ctx.match[1];
  const targetId = ctx.match[2];

  const g = state.groups[groupId];
  if (!g || g.adminId !== admin.id) {
    await ctx.reply("You are not admin of that community.");
    return;
  }

  const list = state.pendingJoinRequests[groupId] || [];
  const idx = list.findIndex((r) => String(r.userId) === String(targetId));
  if (idx >= 0) {
    list.splice(idx, 1);
  }

  await ctx.reply(`❌ Denied user ${targetId} for "${g.title}".`);

  try {
    await bot.api.sendMessage(
      targetId,
      `❌ Your request to join "${g.title}" was denied.`
    );
  } catch (err) {
    console.error("Couldn't DM denied user:", err.message);
  }
});

// /setweight flow (admin only, in DM)
bot.command("setweight", async (ctx) => {
  const chat = ctx.chat;
  const admin = ctx.from;
  if (chat.type !== "private") return;

  const adminGroups = Object.entries(state.groups).filter(
    ([gid, g]) => g.adminId === admin.id
  );
  if (adminGroups.length === 0) {
    await ctx.reply("You don't administer any communities.");
    return;
  }

  state.pendingWeightChange[admin.id] = {
    step: "pick_group",
    groupId: null,
    targetUserId: null,
    newWeight: null,
    reason: null,
  };

  const kb = new InlineKeyboard();
  for (const [gid, g] of adminGroups) {
    kb.text(g.title || gid, `wgroup_${gid}`).row();
  }

  await ctx.reply("Which community do you want to modify weights for?", {
    reply_markup: kb,
  });
});

bot.callbackQuery(/^wgroup_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const admin = ctx.from;
  const groupId = ctx.match[1];

  const flow = state.pendingWeightChange[admin.id];
  if (!flow || flow.step !== "pick_group") {
    return;
  }

  const g = state.groups[groupId];
  if (!g || g.adminId !== admin.id) {
    await ctx.reply("You are not admin of that community.");
    return;
  }

  flow.groupId = groupId;
  flow.step = "pick_user";

  const kb = new InlineKeyboard();
  for (const uid in g.members) {
    if (g.members[uid].approved) {
      kb.text(`User ${uid} (w=${g.members[uid].weight})`, `wuser_${uid}`).row();
    }
  }

  await ctx.reply(
    `Pick which user you want to change weight for in "${g.title}":`,
    { reply_markup: kb }
  );
});

bot.callbackQuery(/^wuser_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const admin = ctx.from;
  const targetUserId = ctx.match[1];
  const flow = state.pendingWeightChange[admin.id];
  if (!flow || flow.step !== "pick_user") return;

  const g = state.groups[flow.groupId];
  if (!g || g.adminId !== admin.id) {
    await ctx.reply("You are not admin of that community.");
    return;
  }

  if (!g.members[targetUserId] || !g.members[targetUserId].approved) {
    await ctx.reply("That user is not approved in this community.");
    return;
  }

  flow.targetUserId = targetUserId;
  flow.step = "set_weight";

  await ctx.reply(
    `Current weight for user ${targetUserId} is ${g.members[targetUserId].weight}.\n` +
      "Reply with the NEW weight (number > 0)."
  );
});

// admin DM message handling for weight flow + proposal creation flow
bot.on("message:text", async (ctx, next) => {
  const chat = ctx.chat;
  const from = ctx.from;
  const text = ctx.message.text.trim();

  // handle weight change flow
  if (chat.type === "private" && state.pendingWeightChange[from.id]) {
    const flow = state.pendingWeightChange[from.id];

    if (flow.step === "set_weight") {
      const wNum = parseInt(text, 10);
      if (isNaN(wNum) || wNum <= 0) {
        await ctx.reply("Please send a positive integer weight.");
        return;
      }
      flow.newWeight = wNum;
      flow.step = "set_reason";
      await ctx.reply(
        "Got it. Now send a short reason for this change (e.g. 'promotion', 'left team').\n" +
          "Or reply 'skip' to continue without a reason."
      );
      return;
    }

    if (flow.step === "set_reason") {
      flow.reason = text.toLowerCase() === "skip" ? "(no reason given)" : text;
      flow.step = "done";

      const g = state.groups[flow.groupId];
      if (!g || g.adminId !== from.id) {
        await ctx.reply("That community no longer exists or you're not admin.");
        delete state.pendingWeightChange[from.id];
        return;
      }
      if (!g.members[flow.targetUserId]) {
        await ctx.reply("That user is no longer in this community.");
        delete state.pendingWeightChange[from.id];
        return;
      }

      g.members[flow.targetUserId].weight = flow.newWeight;

      await ctx.reply(
        `✅ Updated weight for user ${flow.targetUserId} in "${g.title}" to ${flow.newWeight}.\nReason: ${flow.reason}`
      );

      try {
        await bot.api.sendMessage(
          flow.targetUserId,
          `ℹ️ Your voting weight in "${g.title}" was updated to ${flow.newWeight}.\nReason: ${flow.reason}`
        );
      } catch (err) {
        console.error("Couldn't DM updated user:", err.message);
      }

      delete state.pendingWeightChange[from.id];
      return;
    }
  }

  // handle proposal creation flow (/new)
  if (chat.type === "private") {
    const uState = state.userPrivateState[from.id];
    if (uState && uState.step) {
      // awaiting title
      if (uState.step === "await_title") {
        uState.draftProposal = {
          title: text,
          description: "",
          options: [],
          groupId: null,
          durationMins: 5,
        };
        uState.step = "await_description";
        await ctx.reply(
          "Got it. Send a short description or context for voters (or reply 'skip')."
        );
        return;
      }

      // awaiting description
      if (uState.step === "await_description") {
        if (text.toLowerCase() !== "skip") {
          uState.draftProposal.description = text;
        }
        uState.step = "await_options";
        await ctx.reply(
          "Now send the options separated by commas.\nExample:\nYes, No\nor\nAlice, Bob, Abstain"
        );
        return;
      }

      // awaiting options
      if (uState.step === "await_options") {
        const opts = text
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (opts.length < 2) {
          await ctx.reply("Need at least 2 options. Try again:");
          return;
        }
        uState.draftProposal.options = opts;
        uState.step = "await_duration";
        await ctx.reply(
          "How many minutes should voting stay open?\n(Example: 10)"
        );
        return;
      }

      // awaiting duration
      if (uState.step === "await_duration") {
        const m = parseInt(text, 10);
        if (isNaN(m) || m <= 0) {
          await ctx.reply("Please send a positive number of minutes.");
          return;
        }
        uState.draftProposal.durationMins = m;

        // ask group
        const adminGroups = Object.entries(state.groups).filter(
          ([gid, g]) => g.adminId === from.id
        );
        if (adminGroups.length === 0) {
          await ctx.reply(
            "You are not admin of any group. Can't publish a vote."
          );
          delete state.userPrivateState[from.id];
          return;
        }

        const kb = new InlineKeyboard();
        for (const [gid, g] of adminGroups) {
          kb.text(g.title || gid, `publishgroup_${gid}`).row();
        }

        uState.step = "await_group_choice";

        await ctx.reply("Which community should get this vote?", {
          reply_markup: kb,
        });
        return;
      }
    }
  }

  await next();
});

// /new (admin DM)
bot.command("new", async (ctx) => {
  const chat = ctx.chat;
  const user = ctx.from;
  if (chat.type !== "private") return;

  const adminGroups = Object.entries(state.groups).filter(
    ([gid, g]) => g.adminId === user.id
  );
  if (adminGroups.length === 0) {
    await ctx.reply("You are not admin of any community.");
    return;
  }

  state.userPrivateState[user.id] = {
    step: "await_title",
    draftProposal: null,
  };

  await ctx.reply(
    "Let's create a new vote.\n\nFirst: send the *title* of the proposal (question being voted on)."
  );
});

// admin picked which group to publish vote in
bot.callbackQuery(/^publishgroup_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const admin = ctx.from;
  const chatIdChosen = ctx.match[1];

  const uState = state.userPrivateState[admin.id];
  if (!uState || uState.step !== "await_group_choice") {
    await ctx.reply("This proposal creation flow is not active.");
    return;
  }

  const g = state.groups[chatIdChosen];
  if (!g || g.adminId !== admin.id) {
    await ctx.reply("You are not admin of that community.");
    delete state.userPrivateState[admin.id];
    return;
  }

  // finalize proposal
  const newId = state.nextProposalId++;
  const draft = uState.draftProposal;

  const now = Date.now();
  const endsAt = now + draft.durationMins * 60 * 1000;

  state.proposals[newId] = {
    id: newId,
    groupId: parseInt(chatIdChosen, 10),
    title: draft.title,
    description: draft.description || "",
    options: draft.options,
    createdAt: new Date(now).toISOString(),
    endsAt,
    closedAt: null,
    closedManually: false,
    votes: {}, // userId -> { choiceIndex, weight }
    tally: draft.options.map(() => 0),
  };

  g.proposals.push(newId);

  await ctx.reply(
    `✅ Proposal #${newId} created for "${g.title}".\n` +
      `Voting will last ${draft.durationMins} min.\n` +
      "I'm now DM'ing approved voters with the ballot."
  );

  // DM each approved voter with buttons
  for (const uid in g.members) {
    const member = g.members[uid];
    if (member.approved && member.weight > 0) {
      const voteKb = new InlineKeyboard();
      draft.options.forEach((opt, idx) => {
        voteKb.text(opt, `cast_${newId}_${idx}`).row();
      });

      try {
        await bot.api.sendMessage(
          uid,
          `🗳 New vote in "${g.title}"!\n\n` +
            `#${newId}: ${draft.title}\n` +
            (draft.description ? `\n${draft.description}\n` : "") +
            `\nTap your choice:`,
          { reply_markup: voteKb }
        );
      } catch (err) {
        console.error("Failed to DM voter:", err.message);
      }
    }
  }

  delete state.userPrivateState[admin.id];

  // schedule auto-close check
  setTimeout(() => {
    maybeCloseProposal(bot, newId);
  }, draft.durationMins * 60 * 1000);
});

// voter clicks on a choice in DM
bot.callbackQuery(/^cast_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const voter = ctx.from;
  const proposalId = ctx.match[1];
  const optIndex = parseInt(ctx.match[2], 10);

  const p = state.proposals[proposalId];
  if (!p) {
    await ctx.reply("This proposal no longer exists.");
    return;
  }

  const g = state.groups[p.groupId];
  if (!g) {
    await ctx.reply("Community not found.");
    return;
  }

  if (!isProposalOpen(p)) {
    await ctx.reply("⏰ Voting is already closed for this proposal.");
    return;
  }

  if (!g.members[voter.id] || !g.members[voter.id].approved) {
    await ctx.reply("You are not approved to vote in this community.");
    return;
  }

  const weight = g.members[voter.id].weight || 0;
  if (weight <= 0) {
    await ctx.reply(
      "Your voting weight is currently 0 in this community, you cannot vote."
    );
    return;
  }

  // record/update vote
  p.votes[voter.id] = {
    choiceIndex: optIndex,
    weight: weight,
    at: new Date().toISOString(),
  };

  // rebuild tally
  p.tally = p.options.map(() => 0);
  Object.values(p.votes).forEach((v) => {
    p.tally[v.choiceIndex] += v.weight;
  });

  await ctx.reply(
    "✅ Vote recorded.\n\n" +
      `Proposal #${p.id}: "${p.title}"\n` +
      "You can change your vote until the vote closes."
  );

  // after each vote, check if we can auto-close (quorum or deadline)
  maybeCloseProposal(bot, proposalId);
});

// /close (admin DM) -> pick which proposal to immediately close
bot.command("close", async (ctx) => {
  const chat = ctx.chat;
  const admin = ctx.from;
  if (chat.type !== "private") return;

  const openProposals = Object.values(state.proposals).filter((p) => {
    const g = state.groups[p.groupId];
    return g && g.adminId === admin.id && isProposalOpen(p);
  });

  if (openProposals.length === 0) {
    await ctx.reply("No active proposals to close.");
    return;
  }

  const kb = new InlineKeyboard();
  openProposals.forEach((p) => {
    kb.text(`#${p.id}: ${p.title}`, `forceclose_${p.id}`).row();
  });

  await ctx.reply("Which proposal do you want to close right now?", {
    reply_markup: kb,
  });
});

bot.callbackQuery(/^forceclose_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const admin = ctx.from;
  const proposalId = ctx.match[1];
  const p = state.proposals[proposalId];
  if (!p) {
    await ctx.reply("Proposal not found.");
    return;
  }
  const g = state.groups[p.groupId];
  if (!g || g.adminId !== admin.id) {
    await ctx.reply("You're not the admin of this proposal's community.");
    return;
  }

  p.closedManually = true;
  p.endsAt = Date.now();
  await maybeCloseProposal(bot, proposalId);

  await ctx.reply(`🔒 Proposal #${proposalId} is now closed.`);
});

// /results (admin DM)
bot.command("results", async (ctx) => {
  const chat = ctx.chat;
  const admin = ctx.from;
  if (chat.type !== "private") return;

  const adminGroupIds = Object.entries(state.groups)
    .filter(([gid, g]) => g.adminId === admin.id)
    .map(([gid]) => parseInt(gid, 10));

  const relevant = Object.values(state.proposals).filter((p) =>
    adminGroupIds.includes(p.groupId)
  );

  if (relevant.length === 0) {
    await ctx.reply("No proposals found for your communities.");
    return;
  }

  const kb = new InlineKeyboard();
  relevant.forEach((p) => {
    const openFlag = isProposalOpen(p) ? "🟢" : "🔒";
    kb.text(`${openFlag} #${p.id}: ${p.title}`, `showres_${p.id}`).row();
  });

  await ctx.reply("Which proposal results do you want to view?", {
    reply_markup: kb,
  });
});

bot.callbackQuery(/^showres_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const admin = ctx.from;
  const proposalId = ctx.match[1];

  const p = state.proposals[proposalId];
  if (!p) {
    await ctx.reply("Proposal not found.");
    return;
  }

  const g = state.groups[p.groupId];
  if (!g || g.adminId !== admin.id) {
    await ctx.reply("You are not admin of this community.");
    return;
  }

  const summary = buildResultsSummary(p);
  await ctx.reply(summary);
});

// =============================
// EXPRESS + WEBHOOK BOOTSTRAP
// =============================
const app = express();
app.use(cors());
app.use(bodyParser.json());

// webhook endpoint Telegram -> bot
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

// main startup
(async () => {
  // init bot (important for webhook mode)
  await bot.init();

  const server = app.listen(PORT, async () => {
    console.log(`🚀 API listening on port ${PORT}`);

    try {
      // clear old webhook & drop pending updates
      await bot.api.deleteWebhook({ drop_pending_updates: true });

      // register new webhook
      await bot.api.setWebhook(`${PUBLIC_URL}/telegram/webhook`);

      console.log(
        "📡 Webhook registered at",
        `${PUBLIC_URL}/telegram/webhook`
      );
    } catch (err) {
      console.error("❌ Failed to set webhook:", err);
    }
  });

  // IMPORTANT: do NOT call bot.start() here.
  // bot.start() is for polling mode, not webhook mode.
})();
