import type { Metadata } from "next";
import { Info } from "@/components/Info";
import { KeyUsage } from "@/components/developers/KeyUsage";
import "../../pages.css";
import "../dev.css";

export const metadata: Metadata = { title: "Your keys", description: "Your Remedy sandbox keys, their usage, and rotate or revoke." };

export default function KeysPage() {
  return (
    <div className="page frame">
      <header className="page-head">
        <div className="title-row">
          <h1 className="page-title">Your keys</h1>
          <Info id="page.keys" />
        </div>
        <p className="lede">Keys created in this browser, the calls they made, and rotate or revoke. There are no passwords: this browser remembers the keys it created.</p>
      </header>
      <KeyUsage />
    </div>
  );
}
