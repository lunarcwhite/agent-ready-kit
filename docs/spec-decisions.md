# Keputusan Audit Spesifikasi — 2026-09-29

Hasil pilihan user atas temuan konflik/ambiguitas/tumpang tindih
di `AGENTS.md`, `docs/PRD.md`, `architecture.md`, `database-schema.md`,
`agents.md`, `soul.md`, `design.md`, `tasks.md`, `screen-blueprint.md`.

Status tiap item: DECIDED (menunggu diterapkan ke dokumen sumber).

## Otoritas

- **D-00.** `screen-blueprint.md` = pelengkap (contoh rute/copy).
  Jika bertentangan, yang menang: `design.md` / PRD / tasks.

## Konflik (C)

- **D-C01.** Readiness kanonis = 8 dimensi PRD
  (Product, Features, Business Rules, Data, UX, Architecture, Security, Execution).
  Perbaiki: `soul.md` §46, `screen-blueprint.md` §6 & §13.
- **D-C02.** Status discovery node = versi DB:
  UNKNOWN, PARTIAL, RESOLVED, NOT_APPLICABLE.
  Perbaiki: `tasks.md` TASK-030.
- **D-C03.** Level discovery = 4 level versi DB:
  INITIAL, QUICK_DRAFT, DETAILED, AGENT_READY.
  Perbaiki: `PRD.md` §12, `tasks.md` TASK-031 (hapus sufiks `_DISCOVERY`).
- **D-C04.** Lifecycle = DISCOVERY, DRAFT, NEEDS_REVIEW, IMPLEMENTATION_READY.
  Perbaiki: `screen-blueprint.md` §3.
- **D-C05.** Severity = BLOCKER, HIGH, MEDIUM, LOW, INFO;
  format kode `ISSUE-xxx` / `ASM-004`.
  Perbaiki: `screen-blueprint.md` §13 (hapus CRITICAL/WARNING, `C-001`/`W-003`).
- **D-C06.** Tambah `project_id` ke `decision_dependencies`.
  Template global = tabel terpisah di masa depan, bukan sekarang.
- **D-C07.** Dua kolom: `decision_key` (dot-notation, logika) +
  `decision_code` format `DEC-AUTH-001` (tampilan/traceability).
  Tambah kolom ke tabel `decisions`; definisikan format di `database-schema.md` + TASK-004.
- **D-C08.** Buat model penyimpanan `ARC-*` agar traceability FR → ARC verifiable
  dan TASK-063 bisa dikerjakan.
- **D-C09.** Lengkapi model SCREEN: enum status tabel `screens`,
  task domain model untuk screens, katalog `SCREEN-*`.
- **D-C10.** Navigasi proyek = versi `design.md` §13
  (Overview; Define: Discovery, Decisions; Specify: Product, Architecture, Data,
  Design, AI; Validate: Issues, Readiness; Execute: Tasks; Ship: Agent Kit).
  Perbaiki: `screen-blueprint.md` §8/§24.

## Ambigu / missing (A)

- **D-A01.** Auth MVP default = Email+password + Google OAuth
  via managed auth abstraction. Tetapkan di PRD/TASK-010.
- **D-A02.** Buat tabel mapping `source_type` × `confidence` → 5 provenance TASK-025.
- **D-A03.** Tambah `capability` + `state version` ke `ai_operations`;
  lengkapi tipe operasi (Knowledge, Design/Agent/Soul compile, Impact, Instruction).
- **D-A04.** Manifest kanonis = daftar TASK-103; tambah readiness + artifact list
  ke tabel `exports`.
- **D-A05.** `project_settings.settings` kanonis; hapus duplikat
  `projects.preferred_language` dan `project_inputs.preferred_stack`.
- **D-A06.** Tambah SUPERSEDED ke enum requirement status.
- **D-A07/08/09.** Tambah task baru untuk: README compiler, lifecycle
  `proposed_changes`, persistensi screens, delete/archive, job persistence.
- **D-A10a.** Tetapkan default bahasa output + enum nilai `preferred_language`.
- **D-A10b.** Contoh user-project task pakai prefix beda (mis. `UTASK-xxx`);
  `TASK-xxx` tetap milik rencana implementasi.
- **D-KNOW.** Buat tabel pemetaan kanonis kategori knowledge
  (PRD FR-030 × DB domains × TASK-055 × Discovery domains) sebelum TASK-055/056.

## Penerapan (2026-09-29)

- [x] D-00: authority note di `screen-blueprint.md` §0.
- [x] D-C01: `soul.md` §46 (+Business Rules); `screen-blueprint.md` §13
      diganti 8 dimensi kanonis; panel Discovery §6 diberi catatan
      pembeda discovery-coverage vs readiness.
- [x] D-C02: `tasks.md` TASK-030 → enum versi DB.
- [x] D-C03: `PRD.md` §12 + INITIAL; `tasks.md` TASK-031 →
      INITIAL/QUICK_DRAFT/DETAILED/AGENT_READY.
- [x] D-C04: `screen-blueprint.md` §3 → DRAFT / Needs Review /
      Implementation Ready + catatan lifecycle kanonis.
- [x] D-C05: `screen-blueprint.md` §13 → BLOCKER/MEDIUM + `ISSUE-xxx`.
- [x] D-C06: `project_id` ditambah ke `decision_dependencies`;
      indeks dependency ditambah di §65.
- [x] D-C07: kolom `decision_code` + unique + catatan format di
      `database-schema.md` §11; format code di `tasks.md` TASK-004.
- [x] D-C08: tabel `architecture_components` baru (§45a) + MVP boundary + indeks.
- [x] D-C09: enum + unique `screens` (§45); TASK-059 mencakup ARC + SCREEN;
      TASK-063 depend on TASK-059.
- [x] D-C10: `screen-blueprint.md` §0/§8/§24 → nav versi `design.md` + Issues;
      namespace note di `design.md` §57 + authority note blueprint.
- [x] D-A01: `tasks.md` TASK-010 → Email+password + Google OAuth default.
- [x] D-A02: mapping provenance di `tasks.md` TASK-025.
- [x] D-A03: `capability` + `project_state_version` di `ai_operations`;
      tipe operasi dilengkapi.
- [x] D-A04: `PRD.md` FR-121 + contoh manifest `architecture.md` §41
      disamakan ke TASK-103; `readiness_state` + `included_artifacts`
      ditambah ke tabel `exports`.
- [x] D-A05: `preferred_language` / `preferred_stack` dihapus dari
      `projects` / `project_inputs`; kanonis di `project_settings` + default `en`.
- [x] D-A06: SUPERSEDED di enum requirement status.
- [x] D-A07/08/09: TASK-059 (+README), TASK-130 (delete/archive),
      TASK-131 (job persistence), TASK-132 (proposed-change lifecycle).
- [x] D-A10a: default `en`, allowed `en`/`id` di `project_settings` + §19.
- [x] D-A10b: namespace note `design.md` §57 + authority note blueprint.
- [x] D-KNOW: `tasks.md` §18a deliverable mapping; referensi di DB §19.
- [x] Critical path: TASK-059 dimasukkan (TASK-059–065).
- [x] D-CRIT: Decision Impact 3 level (HIGH/MEDIUM/LOW); CRITICAL dihapus.
