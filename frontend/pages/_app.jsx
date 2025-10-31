// frontend/pages/_app.jsx
import Head from "next/head";
import { PrivyProvider } from "@privy-io/react-auth";
import "../globals.css";

export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        {/* Fonte display pra usar no título BALLOTEER */}
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&display=swap"
          rel="stylesheet"
        />

        {/* SEO básico */}
        <title>Balloteer — private on-chain governance in Telegram</title>
        <meta
          name="description"
          content="Anonymous weighted voting with quorum and on-chain settlement – all from Telegram DMs."
        />

        {/* Open Graph / social share */}
        <meta
          property="og:title"
          content="Balloteer — 5-second governance in Telegram"
        />
        <meta
          property="og:description"
          content="10 minutes → 5 seconds. Wallets → Just Telegram. Public votes → Private DMs. No proof → On-chain."
        />
        {/* depois você troca por uma imagem real no /public */}
        <meta property="og:image" content="https://balloteer.xyz/og-preview.png" />
        <meta property="og:type" content="website" />

        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="Balloteer — 5-second governance in Telegram"
        />
        <meta
          name="twitter:description"
          content="Weighted, anonymous voting with quorum. Final result on-chain. No crypto knowledge required."
        />
        <meta name="twitter:image" content="https://balloteer.xyz/og-preview.png" />

        {/* favicon */}
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* aqui começa o Privy */}
      <PrivyProvider
        appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID}
        config={{
          appearance: {
            theme: "dark",
            accentColor: "#4f46e5",
          },
          loginMethods: ["wallet", "email", "google", "telegram"],
          embeddedWallets: {
            createOnLogin: true,
          },
        }}
      >
        <main className="min-h-screen bg-black text-white antialiased">
          <Component {...pageProps} />
        </main>
      </PrivyProvider>
    </>
  );
}
