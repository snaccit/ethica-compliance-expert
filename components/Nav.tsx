"use client";
import { Library, MessageSquareText, Share2 } from "lucide-react";
import Link from "next/link";
import Logo from "./Logo";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Fragen", Icon: MessageSquareText },
  { href: "/graph", label: "Wissensgraph", Icon: Share2 },
  { href: "/quellen", label: "Gesetze", Icon: Library },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="rail">
      <Link href="/" className="brand" aria-label="Compliance Expert Startseite"><Logo size={38} /></Link>
      {items.map(({ href, label, Icon }) => (
        <Link key={href} href={href} className={path === href ? "active" : ""} aria-label={label}>
          <Icon size={19} strokeWidth={1.7} />
          <span className="tip">{label}</span>
        </Link>
      ))}
    </nav>
  );
}
