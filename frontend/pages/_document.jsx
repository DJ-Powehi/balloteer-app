import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html className="bg-black">
      <Head>
        {/* tenta .ico primeiro; se vc tiver só .png, troca o href */}
        <link rel="icon" href="/favicon.png" />
      </Head>
      <body className="bg-black text-white">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
