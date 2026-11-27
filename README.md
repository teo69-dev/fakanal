# Fakanál

Egyszerű receptes oldal. Az olvasás és a keresés nyilvános, új receptet csak jelszóval lehet felvenni.

- Next.js (App Router), TypeScript, Postgres (Neon), Drizzle ORM, zod
- Oldalak: `/` lista és keresés, `/recept/[slug]`, `/belepes`, `/uj`
- API: `POST /api/login`, `POST /api/logout`, `POST /api/recipes`, `PUT /api/recipes/[slug]` (szerkesztés) és `DELETE /api/recipes/[slug]` (törlés), mindkettő csak belépve, `POST /api/import` (recept betöltése egy oldal schema.org-adatából, csak belépve)

## Helyi fejlesztés

```bash
npm ci
cp .env.example .env.local   # töltsd ki; a fájl nincs a repóban
npm run db:migrate           # DATABASE_URL kell hozzá
npm run dev
```

Ellenőrzések: `npm run typecheck`, `npm test`, `npm run build`.

## Üzembe helyezés

Lásd [docs/DEPLOY.md](docs/DEPLOY.md).

## Biztonság röviden

- A jelszó és a titkos kulcsok csak környezeti változók (`.env.example`), a repóban nincs titok.
- A belépés ellenőrzése a szerveren történik (időzítés-biztos összevetés), a munkamenet aláírt, `HttpOnly`, `Secure`, `SameSite=Strict` süti.
- Hibás belépési próbák korlátozva (IP-nként 5 próba 15 percen belül), az írás-útvonalak az `Origin` fejlécet is ellenőrzik.
- A recepteket a felület sima szövegként rendereli (nincs HTML és markdown).
- Ugyanaz a recept egy percen belül kétszer mentve egy receptet ad (dupla kattintás ellen: a gomb is tiltva van, és a szerver is felismeri). Törlés csak belépve, megerősítéssel, legfeljebb 7 törlés 15 percenként.
- Az import csak belépve megy, csak nyilvános `https://` címekről tölt (névfeloldás után és átirányításoknál is ellenőrizve), 8 mp és 5 MB a korlát, és nem talál ki semmit: ami az oldalon nincs, az üres marad.
- A kép-cím csak nyilvános `https://` cím lehet: IP-cím, `localhost`, belső név (`.local`, `.internal`, egyszavas név) és `felhasználó:jelszó@` nem.
