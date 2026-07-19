import Link from "next/link";

import { LogoutButton } from "./logout-button";

export function AppNavigation({ isAdmin, displayName }: { isAdmin: boolean; displayName?: string }) {
  return (
    <nav className="app-navigation" aria-label="Main navigation">
      <Link href="/albums">Albums</Link>
      {isAdmin ? <Link href="/admin/albums">Album templates</Link> : null}
      {isAdmin ? <Link href="/admin/users">Users</Link> : null}
      {displayName ? <span className="user-pill">{displayName}</span> : null}
      <LogoutButton />
    </nav>
  );
}
