import Link from "next/link";

export function PublicPage({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-[#f6f7fb] px-4 py-8 text-[#15172a] sm:py-14">
      <article className="mx-auto max-w-3xl rounded-3xl border border-black/5 bg-white p-6 shadow-sm sm:p-10">
        <p className="mb-3 text-sm font-medium text-[#536078]">Kiara Operations</p>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-[#687086]">آخر تحديث: {updatedAt}</p>
        <div className="mt-8 space-y-7 leading-8 text-[#30364a]">{children}</div>
        <nav className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-black/5 pt-6 text-sm font-medium text-[#2b3fb0]">
          <Link href="/privacy">الخصوصية</Link>
          <Link href="/terms">الشروط</Link>
          <Link href="/support">الدعم</Link>
        </nav>
      </article>
    </main>
  );
}

export function PublicSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xl font-bold text-[#171a2b]">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
