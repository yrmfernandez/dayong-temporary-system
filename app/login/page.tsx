"use client";

import { Eye, EyeOff, ExternalLink, HeartHandshake, LockKeyhole, UserRound } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const prayer = `Heavenly Father, I enter this workplace as I bring Your presence with me. I speak Your peace, grace, mercy, and perfect order into my work. I acknowledge Your power over all that will be done, spoken, thought, and decided within these walls.

I commit to use my gifts responsibly in Your honor. Give me a fresh supply of strength to do my job. Anoint my programs, ideas, and energy so that even my smallest accomplishment may bring You glory.

Lord, when I am confused, please guide me. When I am weary, energize me. When I am burned out, infuse me with the light of the Holy Spirit. May the work that I do, and the way I do it, bring faith, joy, and smiles to everyone I meet.

Lord, please help me remain focused and productive today. When I leave this place, grant me traveling mercy. Bless my family and keep my home in order as I left it.

We thank You for all You have done, everything You are doing, and everything You are going to do. We thank You for the gifts with which You have blessed us. In the name of the Father, and of the Son, and of the Holy Spirit. Amen.`;

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false); const [message, setMessage] = useState(""); const [submitting, setSubmitting] = useState(false);
  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    if (!username.trim() || !password) { setMessage("Enter your username and password."); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const responseText = await response.text(); let result: { success?: boolean; message?: string } = {};
      try { result = JSON.parse(responseText) as typeof result; } catch { throw new Error(response.ok ? "The sign-in server returned an invalid response." : "The sign-in server is unavailable. Check the Vercel Function logs and environment variables."); }
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to sign in.");
      router.replace("/"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to sign in."); }
    finally { setSubmitting(false); }
  }
  return <main className="grid h-screen overflow-y-auto bg-white lg:grid-cols-[1.08fr_0.92fr] lg:overflow-hidden">
    <section className="relative hidden overflow-y-auto bg-violet-10 px-10 py-9 text-white lg:flex lg:flex-col xl:px-16">
      <div className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full bg-violet-60/35 blur-3xl"/><div className="pointer-events-none absolute -bottom-32 -right-24 size-96 rounded-full bg-accent-lime/20 blur-3xl"/>
      <div className="relative z-10 flex items-center gap-4"><BrandLogo className="size-20 rounded-full bg-white object-contain p-1 shadow-xl" priority/><div><p className="text-2xl font-black tracking-tight">DAYONG</p><p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-80">D&apos; San Roque Dayong Providers, Inc.</p></div></div>
      <div className="relative z-10 my-auto max-w-2xl py-10"><div className="mb-7 flex size-12 items-center justify-center rounded-2xl bg-accent-lime text-violet-10 shadow-lg"><HeartHandshake className="size-6"/></div><h1 className="max-w-xl text-4xl font-black leading-tight tracking-tight xl:text-5xl">Serving and protecting the needs of every member.</h1>
        <div className="mt-8 grid gap-4 xl:grid-cols-2"><article className="rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur"><p className="text-xs font-bold uppercase tracking-widest text-accent-lime">Vision</p><p className="mt-2 text-sm leading-6 text-violet-95">A fully committed DAYONG provider with high regard for serving and protecting the needs of its members.</p></article><article className="rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur"><p className="text-xs font-bold uppercase tracking-widest text-accent-lime">Mission</p><p className="mt-2 text-sm leading-6 text-violet-95">To bond and unite the members of D&apos; San Roque Dayong Provider, Inc. by serving social needs through helping and extending assistance in case of death.</p></article></div>
        <details className="group mt-4 rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur"><summary className="cursor-pointer list-none text-sm font-bold text-accent-lime">Dayong Workplace Prayer <span className="float-right text-violet-80 group-open:rotate-180">⌄</span></summary><p className="mt-4 whitespace-pre-line text-xs leading-5 text-violet-95">{prayer}</p></details>
      </div>
      <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-4 text-xs text-violet-80"><span>© 2026 Dayong Monitoring System</span><a href="https://www.facebook.com/dsrdprovidersinc" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold hover:text-white">Facebook Page <ExternalLink className="size-3"/></a></div>
    </section>
    <section className="flex min-h-screen flex-col px-6 py-6 sm:px-12 lg:px-16 xl:px-24"><div className="flex items-center gap-3 lg:hidden"><BrandLogo className="size-14 rounded-full object-contain" priority/><div><p className="font-black text-violet-10">DAYONG</p><p className="text-[10px] uppercase tracking-wider text-violet-40">Monitoring System</p></div></div>
      <div className="my-auto w-full max-w-md self-center py-10"><div className="mb-8"><span className="rounded-md bg-purple-95 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-purple-60">Secure Employee Access</span><h2 className="mt-3 text-3xl font-black tracking-tight text-violet-10 sm:text-4xl">Welcome back</h2><p className="mt-2 text-sm text-violet-40">Enter your employee account credentials to continue.</p></div>
        <form className="space-y-5" onSubmit={handleLogin}><div className="space-y-2"><Label htmlFor="username" className="font-bold text-violet-10">Email or username</Label><div className="relative"><UserRound className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-violet-60"/><Input id="username" autoComplete="username" className="h-12 rounded-xl pl-10" value={username} onChange={e=>setUsername(e.target.value)} disabled={submitting} placeholder="Enter your username"/></div></div>
          <div className="space-y-2"><Label htmlFor="password" className="font-bold text-violet-10">Password</Label><div className="relative"><LockKeyhole className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-violet-60"/><Input id="password" type={showPassword?"text":"password"} autoComplete="current-password" className="h-12 rounded-xl px-10" value={password} onChange={e=>setPassword(e.target.value)} disabled={submitting} placeholder="Enter your password"/><button type="button" onClick={()=>setShowPassword(v=>!v)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-violet-40 hover:bg-violet-95 hover:text-violet-60" aria-label={showPassword?"Hide password":"Show password"}>{showPassword?<EyeOff className="size-4"/>:<Eye className="size-4"/>}</button></div></div>
          {message&&<p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{message}</p>}<Button type="submit" className="h-12 w-full rounded-xl text-base font-extrabold shadow-[0_10px_25px_-5px_rgb(105_51_255_/_0.35)]" disabled={submitting}>{submitting?"Signing in...":"Log In"}</Button></form>
        <div className="mt-8 border-t border-violet-90 pt-6 text-center lg:hidden"><p className="text-xs font-bold uppercase tracking-wider text-accent-moss">Our Vision</p><p className="mt-2 text-sm leading-6 text-violet-40">A fully committed DAYONG provider with high regard for serving and protecting the needs of its members.</p><a href="https://www.facebook.com/dsrdprovidersinc" target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-violet-60">Visit our Facebook page <ExternalLink className="size-3"/></a></div>
      </div><p className="text-center text-xs text-muted-foreground">Authorized personnel only · Credentials are protected by a secure session.</p></section>
  </main>;
}
