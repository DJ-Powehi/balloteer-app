HEAD
# Balloteer 🗳

Balloteer lets any community run verifiable, auditable votes from Telegram.

What works right now:
- /join flow: user asks to join voting
- admin approves and assigns weight
- /new creates a proposal
- voting happens in private DMs
- /close ends proposal and posts the result

Repo layout:
- bot.js          → Telegram bot (grammy)
- backend/        → Express API (future: connect Telegram user to Privy wallet)
- frontend/       → Web app (future: login + wallet creation with Privy)

Next:
1. Deploy frontend to Vercel (gives us a free URL)
2. Use Privy for "Login with Telegram" to auto-mint a wallet
3. Store voter weight on-chain later (Solana)

# balloteer-app
On-chain voting that works in the real world.
faa935a4fabcdc7b39d7d2d24e4c3995c3f46fcc
