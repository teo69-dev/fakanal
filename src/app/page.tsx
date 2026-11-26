import Link from "next/link";
import { Header } from "@/components/Header";
import { listRecipes, PAGE_SIZE } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string | string[]; page?: string | string[] }> };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function Home({ searchParams }: Props) {
  const sp = await searchParams;
  const q = first(sp.q).slice(0, 100);
  const page = Math.min(Math.max(Math.floor(Number(first(sp.page))) || 1, 1), 10_000);
  const { items, total } = await listRecipes(q, page);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => `/?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div className="wrap">
      <Header />
      <form className="search" action="/" method="get" role="search">
        <input type="search" name="q" defaultValue={q} placeholder="Keresés a receptek nevében" maxLength={100} aria-label="Keresés" />
        <button type="submit">Keresés</button>
      </form>

      {items.length === 0 ? (
        <p className="muted">{q ? "Nincs találat." : "Még nincs recept."}</p>
      ) : (
        <ul className="grid">
          {items.map((r) => (
            <li key={r.slug}>
              <Link className="card" href={`/recept/${r.slug}`}>
                {r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                <div className="body">
                  <div className="title">{r.name}</div>
                  <div className="meta">
                    {r.category ? <span>{r.category}</span> : null}
                    {r.totalMinutes ? <span>{r.totalMinutes} perc</span> : null}
                    {r.servings ? <span>{r.servings} adag</span> : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav className="pager" aria-label="Lapozás">
          {page > 1 ? <Link href={link(page - 1)}>← Újabbak</Link> : <span />}
          <span className="muted">
            {page}. oldal / {pages}
          </span>
          {page < pages ? <Link href={link(page + 1)}>Régebbiek →</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
