import Link from "next/link";

export default function NotFound() {
  return <div className="empty-state standalone"><span>?</span><h1>Nicht gefunden</h1><p>Dieses Album gibt es nicht.</p><Link href="/" className="button button-primary">Zur Startseite</Link></div>;
}
