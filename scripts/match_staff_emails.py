#!/usr/bin/env python3
"""Match the STAFF CONTACT LIST emails to greendogops.person rows and emit
fill-only UPDATE statements (only sets email where it is currently NULL).

Source data: transcribed from the user's STAFF CONTACT LIST images.
Run: python3 scripts/match_staff_emails.py  (writes SQL to stdout, report to stderr)
"""
import json
import re
import sys
import unicodedata

# (display name, email)  -- email None means none provided on the list
CONTACTS = [
    ("Dr. Ren", "rendvm@gmail.com"),
    ("Gladys", "mypetgladys@gmail.com"),  # Chief Communications Officer (Gladys Juliette)
    ("Cynthia Garcia", "greendogcynthiag@gmail.com"),
    ("Andrea Rehrig", "greendogandrear@gmail.com"),
    ("Marc Mercury", "marcm@greendogdental.com"),
    ("Michael Geist", "drgeist@greendogdental.com"),
    ("Heather Rally", "greendogdrrally@gmail.com"),
    ("Andre Faro", "greendogdrfaro@gmail.com"),
    ("Jessica Robertson", "greendogdrrobertson@gmail.com"),
    ("Candice Habawel", "candicehdvm@gmail.com"),
    ("Claudia Lau", "greendogdrclau@gmail.com"),
    ("Celestine Hoh", "greendogcelestine@gmail.com"),
    ("Sherry Vartanian", "greendogsherry@gmail.com"),
    ("Ella Scott", "greendogdrscott@gmail.com"),
    ("Niko Alzate", "greendogdrniko@gmail.com"),
    ("Carley Saelinger", "info@cardiacvet.com"),
    ("Lynette D'Urso", "dogandcatcardio@gmail.com"),
    ("Deija Lighon", "greendogdeija@gmail.com"),
    ("Bianca Alfonso", "mypetbianca@gmail.com"),
    ("Angela Lina", "greendogangelalina@gmail.com"),  # Angela L Perez
    ("Naomi Folta", "greendognaomi@gmail.com"),
    ("Laurence Marai", "greendoglmarai@gmail.com"),
    ("Ana Diaz", "mypetana@gmail.com"),
    ("Sierra Frasier", "mypetsierra@gmail.com"),
    ("Taylor Fox", "greendogtaylor@gmail.com"),
    ("Sonora Chavez", "greendogsonora@gmail.com"),
    ("Madison Greco", None),
    ("Christina Earnest", "mypetchristina@gmail.com"),
    ("Carlos Alexei", "greendogalexei@gmail.com"),  # Carlos Marquez
    ("Lizbeth", "greendoglizbeth@gmail.com"),  # Lizbeth Gallegos
    ("Jessica Lucra", "mypetjessica@gmail.com"),
    ("Ken Padilla", "greendogkpadilla@gmail.com"),
    ("Jisun Choi", "greendogjisun@gmail.com"),
    ("Ethan Young", "greendogethan@gmail.com"),
    ("Saul Garcia", "greendogsaul.g@gmail.com"),
    ("Yalila Martinez", "greendogyalila@gmail.com"),
    ("Isabelle Johnstone", "greendogisabelle.j@gmail.com"),
    ("Monica Vargas", "greendogmonica@gmail.com"),
    ("Giselle Retiguin", "greendoggiselle@gmail.com"),
    ("Tiffany Tesoro", "greendogtiffanyt@gmail.com"),
    ("Alexandra Martin", "greendogalexandra@gmail.com"),
    ("Shelby Ackerman", "greendogshelby@gmail.com"),
    ("Lisa Girtain", "greendoglisa@gmail.com"),
    ("Ashley Paredes", "greendogashleyp@gmail.com"),
    ("Nichole Gibbs", "greendognichole@gmail.com"),
    ("Tanya Bennett", "greendogtanya@gmail.com"),
    ("Brian Mossbrooks", "greendogbrian@gmail.com"),
    ("Taylor Stepnosky", "greendogtaylor.s@gmail.com"),
    ("Olivia Saenz", "greendogolivia@gmail.com"),  # Olivia Guerra?
    ("Maricely Martinez", "greendogmaricely@gmail.com"),
    ("Brandon Orange", "greendogborange@gmail.com"),
    ("Catherine Ramirez", "greendogcatherine@gmail.com"),
    ("Brittany Finch", "greendogbrittany@gmail.com"),
    ("Nauman Ali", "greendogalinauman@gmail.com"),
    ("Zuleyka Chuc", "greendogzuleyka@gmail.com"),
    ("Aislinn Dickey", "greendogaislinn@gmail.com"),
    ("Kirtlynn Moller", "greendogkirtlynn@gmail.com"),
    ("Natalie Ulloa", "greendognat@gmail.com"),
    ("Victoria Portillo", "greendogvictoria@gmail.com"),
    ("Barbara Long", "greendogbarbara.l@gmail.com"),
    ("Lesly Solorzano", "greendoglesly@gmail.com"),
    ("Eric Flores", "greendogeric@gmail.com"),
    ("Jennifer Velasquez", "greendogjennifer@gmail.com"),
    ("Diana Monterde", "greendogdiana@gmail.com"),
    ("Carmen Chan", "greendogcarmen@gmail.com"),
    ("Markie Perez", "greendogmarkie@gmail.com"),
    ("Miguel Antonio", "greendogmiguelan@gmail.com"),  # Miguel Gozalez
    ("Gladys Castro", "greendoggcastro@gmail.com"),
    ("Megan Rolnik", "greendogrolnik@gmail.com"),
    ("Jessica Salazar", "greendogrvtjess@gmail.com"),
    ("Maria Salazar", "greendogmsalazar@gmail.com"),
    ("Angela Fraga", "janinefp1520@gmail.com"),
    ("Ana Livia", "greendoganalivia@gmail.com"),  # Ana L Fraga
    ("Adriana Gutierrez", "greendogadriana@gmail.com"),
    ("Alysia Sanford", "greendogalysias@gmail.com"),
    ("Karen Cuestas", "greendogkarenc@gmail.com"),
    ("Crystal Barrom", "greendogcrystalbarrom@gmail.com"),
    ("Rachael Banyasz", "greendograchaelb@gmail.com"),
    ("Laura Lucia", "greendoglaura@gmail.com"),
    ("Raquel Velez", "greendograq.velez@gmail.com"),
    ("Marelyn Ventura", "greendogmarelyn@gmail.com"),
    ("Nicholas Bermudez", "greendognickb@gmail.com"),
    ("Fidel Fraga", "fidelvettech@gmail.com"),
    ("Joseph Reyes", "greendogjoseph@gmail.com"),
    ("Veronica Rios", "greendogveronica@gmail.com"),
    ("Maria Portillo", "greendogmaria@gmail.com"),
    ("Yasuko Sano", "greendogyasuko@gmail.com"),
    ("Leticia Ceja", "greendogleticia@gmail.com"),
    ("Esmeralda Alfonso", "greendogesmeralda@gmail.com"),
]

# Explicit overrides where the list name differs from the DB name.
# maps normalized list name -> (db_first_token, db_last_token)
OVERRIDES = {
    "ren": ("rene", "garcia"),
    "andre faro": ("andre", "mattos"),
    "gladys": ("gladys", "juliette"),
    "angela lina": ("angela", "perez"),
    "carlos alexei": ("carlos", "marquez"),
    "lizbeth": ("lizbeth", "gallegos"),
    "miguel antonio": ("miguel", "gozalez"),
    "ana livia": ("ana", "fraga"),
    "nicholas bermudez": ("nick", "bermudez"),
    "olivia saenz": ("olivia", "guerra"),
}


def norm(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().strip()
    s = re.sub(r"\b(dr|mr|mrs|ms|dvm|rvt)\b", "", s)
    s = re.sub(r"[^a-z\s]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def first_last(name: str):
    n = norm(name)
    parts = n.split()
    if not parts:
        return ("", "")
    if len(parts) == 1:
        return (parts[0], "")
    return (parts[0], parts[-1])


def main():
    persons = json.load(open(".data/_persons_dump.json"))
    # index employees by (first_token, last_token) and by last_token
    by_pair = {}
    by_last = {}
    for p in persons:
        if p["status"] != "employee":
            continue
        ft = norm(p["first_name"]).split()
        lt = norm(p["last_name"]).split()
        ftok = ft[0] if ft else ""
        ltok = lt[-1] if lt else ""
        by_pair.setdefault((ftok, ltok), []).append(p)
        by_last.setdefault(ltok, []).append(p)

    matches = []
    flagged = []
    unmatched = []
    for name, email in CONTACTS:
        if not email:
            flagged.append((name, email, "no email on list"))
            continue
        nn = norm(name)
        if nn in OVERRIDES:
            ftok, ltok = OVERRIDES[nn]
        else:
            ftok, ltok = first_last(name)
        cand = by_pair.get((ftok, ltok))
        if cand and len(cand) == 1:
            matches.append((name, email, cand[0]))
        elif cand and len(cand) > 1:
            flagged.append((name, email, f"{len(cand)} same-name persons"))
        else:
            # last-name-only fallback
            cand2 = by_last.get(ltok) if ltok else None
            if cand2 and len(cand2) == 1:
                flagged.append((name, email, f"last-only -> {cand2[0]['first_name']} {cand2[0]['last_name']}"))
            else:
                unmatched.append((name, email, "no person match"))

    print("-- Fill-only email updates (sets email only where currently NULL)", file=sys.stderr)
    for name, email, p in matches:
        print(f"  MATCH  {name:24s} -> {p['first_name'].strip()} {p['last_name'].strip():18s} = {email}", file=sys.stderr)
    print("\n-- FLAGGED (needs review):", file=sys.stderr)
    for name, email, why in flagged:
        print(f"  FLAG   {name:24s} {email or '(none)':32s} {why}", file=sys.stderr)
    print("\n-- UNMATCHED:", file=sys.stderr)
    for name, email, why in unmatched:
        print(f"  MISS   {name:24s} {email or '(none)':32s} {why}", file=sys.stderr)
    print(f"\n-- counts: match={len(matches)} flag={len(flagged)} miss={len(unmatched)}", file=sys.stderr)

    # emit SQL for confident matches only -- match on exact (raw) DB name values
    for name, email, p in matches:
        fn = p["first_name"].replace("'", "''")
        ln = p["last_name"].replace("'", "''")
        em = email.replace("'", "''")
        print(
            f"update greendogops.person set email='{em}', updated_at=now() "
            f"where first_name='{fn}' and last_name='{ln}' and email is null;"
        )


if __name__ == "__main__":
    main()
