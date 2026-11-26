# Üzembe helyezés (Vercel + Neon)

Ez az útmutató a Vercel dashboardon és a Neon felületén végzendő lépéseket írja le. **Itt nincs és nem is lehet titok:** a jelszót, a kapcsolati címet és a titkos kulcsokat csak a Vercel környezeti változóiba írd, soha a repóba, issue-ba vagy commit üzenetbe.

A felületek feliratai változhatnak, a lépések lényege ugyanaz.

## 1. A repó importálása a Vercelbe

1. Vercel dashboard, **Add New... > Project**.
2. Válaszd a `teo69-dev/fakanal` repót, **Import**.
3. Framework Preset: **Next.js** (magától felismeri). A build és az output beállítás maradjon az alapértelmezett.
4. Az első deploy még nem fog működni (nincs adatbázis és nincsenek beállítások), ez rendben van. Menj tovább a 2. lépésre.

## 2. Az adatbázis (Neon) hozzáadása

1. A Vercel projektben: **Storage** fül, **Create Database** (vagy a Marketplace-ből **Neon**).
2. Hozz létre egy Postgres adatbázist, és kapcsold a projekthez (Production és Preview környezet is).
3. A Neon integráció a `DATABASE_URL` változót magától beteszi a projekt környezeti változói közé. Ellenőrizd: **Settings > Environment Variables**.

## 3. A környezeti változók

**Settings > Environment Variables**, mindhármat Production **és** Preview környezetre, a titkosakat jelöld **Sensitive**-nek, ha a felület kínálja:

| Név | Érték | Megjegyzés |
|---|---|---|
| `RECIPE_ADMIN_PASSWORD` | a belépési jelszó | te választod; ezt kell beírni a `/belepes` oldalon |
| `RECIPE_SESSION_SECRET` | legalább 32 véletlen karakter | előállítás: `openssl rand -base64 48` |
| `RECIPE_IP_SALT` | legalább 16 véletlen karakter | előállítás: `openssl rand -base64 24` |

Fontos:

- Egyik név elé se tegyél `NEXT_PUBLIC_` előtagot, az a böngészőbe is kikerülne.
- Ha bármelyik hiányzik vagy túl rövid, a belépés **503**-at ad és senkit nem enged be (ez a szándékos, biztonságos viselkedés).

## 4. Az adatbázis-séma létrehozása (migráció)

A táblákat egyszer, kézzel kell létrehozni. A migráció a repóban van (`drizzle/0000_init.sql`).

**A) Parancssorból** (a gépeden, a repó klónjában):

```bash
git clone https://github.com/teo69-dev/fakanal.git
cd fakanal
npm ci
# a kapcsolati címet rejtett beolvasással add meg, így nem kerül a shell előzményei közé:
read -rs -p "DATABASE_URL: " DATABASE_URL && export DATABASE_URL
npm run db:migrate
unset DATABASE_URL
```

A kapcsolati címet a Neon dashboardon találod (Connect / Connection string), vagy a Vercel projekt környezeti változói között.

**B) Ha az A) nem megy** (nem ellenőrzött: a `drizzle-kit migrate` és a Neon közvetlen kapcsolata ezen a gépen nem volt kipróbálható, mert nincs ott adatbázis): nyisd meg a Neon dashboardon az **SQL Editor**t, és illeszd be a `drizzle/0000_init.sql` tartalmát, majd futtasd. A `--> statement-breakpoint` sorok SQL-megjegyzések, nem zavarnak.

Három tábla jön létre: `recipe`, `ingredient`, `login_attempt`.

## 5. Deploy

A környezeti változók módosítása csak új deploynál lép életbe. A Vercel projektben: **Deployments**, a legutóbbi mellett **Redeploy**. Ezután minden `main`-re érkező push magától épít.

## Opcionális: külön Preview-adatbázis

Alapból a Preview (a nem `main` ágakról és a pull requestekből épülő) környezet is a Production adatbázisát és titkait használja, így egy kipróbált ág éles adatot írhat. Tisztább, ha a Preview külön adatbázist kap:

1. A Neon dashboardon hozz létre egy második adatbázist vagy egy **branch**et (az ingyenes csomagban is van).
2. A Vercel projektben, **Settings > Environment Variables**: a `DATABASE_URL` Production értéke maradjon az éles adatbázis, a Preview környezethez add meg a másodikat (a Neon integráció által felvett változót szűkítsd Productionre, és vegyél fel egy külön Preview-os `DATABASE_URL`-t).
3. Futtasd le a Preview-adatbázison is a migrációt (4. lépés, a `DATABASE_URL` a Preview-adatbázisé legyen).
4. Preview-ra is érdemes külön `RECIPE_ADMIN_PASSWORD` és `RECIPE_SESSION_SECRET` értéket adni.

Ez a lépés nem kötelező, az oldal nélküle is működik.

## 6. Ellenőrzés az éles oldalon

1. A főoldal betölt, „Még nincs recept." látszik.
2. `/belepes`: rossz jelszóra „Hibás jelszó.", a jó jelszóval az „Új recept" űrlapra visz.
3. Vegyél fel egy próbareceptet; megjelenik a listán, a recept oldala megnyílik, a keresés ékezet nélkül is megtalálja (pl. „porkolt" a „Pörkölt"-et).
4. Kilépés után az `/uj` a belépés oldalra irányít.
5. Böngésző fejlesztői eszközei, Application > Cookies: az `rk_session` süti **HttpOnly**, **Secure** és **SameSite=Strict**.

## Jelszócsere

1. Írd át a `RECIPE_ADMIN_PASSWORD` értékét.
2. Cseréld a `RECIPE_SESSION_SECRET` értékét is (új `openssl rand -base64 48`): ez minden meglévő munkamenetet érvénytelenít.
3. Redeploy.

## Hibakeresés

| Tünet | Valószínű ok |
|---|---|
| a belépés 503-at ad | hiányzik vagy rövid a `RECIPE_ADMIN_PASSWORD`, a `RECIPE_SESSION_SECRET` (min. 32) vagy a `RECIPE_IP_SALT` (min. 16); javítás után redeploy |
| a főoldal vagy a mentés 500-at ad | hiányzik a `DATABASE_URL`, vagy a migráció (4. lépés) nem futott le |
| a belépés 429-et ad | 15 percen belül 5 hibás jelszópróba érkezett ugyanarról a címről; 15 perc múlva magától oldódik |
| a Vercel nem engedi a deployt a commit szerzője miatt | a commit szerzője a `teo69-dev` GitHub-fiók (noreply) címe legyen |
| mentéskor 429 | egy óra alatt legfeljebb 30 recept vehető fel |

## Ismert kockázat

Ha a jelszó gyenge vagy kiszivárog, bárki kaphat írási jogot, és spam-recepteket vehet fel. A meglévő recepteket nem tudja módosítani vagy törölni, mert a szerkesztés és a törlés nincs megvalósítva. A jelszócsere kódváltoztatás nélkül megoldja.
