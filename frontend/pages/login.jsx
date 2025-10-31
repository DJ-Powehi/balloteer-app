// frontend/pages/login.jsx
import { usePrivy } from "@privy-io/react-auth";

export default function LoginPage() {
  const { login } = usePrivy();

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      {/* glow atrás */}
      <div className="balloteer-bg" />

      {/* conteúdo na frente */}
      <div className="balloteer-shell w-full flex items-center justify-center px-4">
        <div className="bg-[#13131a]/90 border border-white/5 rounded-2xl shadow-2xl w-full max-w-md p-8 backdrop-blur">
          <h1 className="text-2xl font-semibold mb-2 tracking-tight">
            Balloteer Login
          </h1>
          <p className="text-sm text-white/55 mb-6">
            Connect with wallet, email or Telegram.
          </p>
          <button
            onClick={login}
            className="w-full bg-[#5f64ff] hover:bg-[#6f74ff] transition-colors text-white font-medium py-3 rounded-xl shadow-[0_0_30px_rgba(95,100,255,0.45)]"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
import { useRouter } from "next/router";
import { useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";

export default function LoginPage() {
  const router = useRouter();
  const { tg_id } = router.query;
  const { authenticated, user } = usePrivy();
  const { wallets } = useWallets();

  useEffect(() => {
    if (!authenticated) return;
    if (!tg_id) return;
    if (!wallets?.[0]) return;

    // manda pro backend
    fetch("https://SEU-BACKEND-RAILWAY/api/link-telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegram_id: tg_id,
        privy_id: user.id,
        wallet: wallets[0].address,
      }),
    }).catch(console.error);
  }, [authenticated, tg_id, user, wallets]);
  
  // ... resto do componente
}
