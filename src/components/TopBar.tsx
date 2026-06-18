import { Link } from "@tanstack/react-router";
import { Shield, LogIn } from "lucide-react";
import { AtomWordmark } from "@/components/AtomMark";

export function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center" aria-label="Atom — Home">
          <AtomWordmark size="md" />
        </Link>
        <nav className="hidden items-center gap-1 text-sm md:flex">
          <Link to="/admin" activeProps={{ className: "text-foreground" }} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition hover:text-foreground">
            <Shield className="h-3.5 w-3.5" /> Admin
          </Link>
          <Link to="/auth" className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90">
            <LogIn className="h-3.5 w-3.5" /> Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
