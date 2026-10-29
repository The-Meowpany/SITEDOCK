import pathlib

p = pathlib.Path("packages/database/prisma/migrations/0006_organization_domain_repair/migration.sql")
content = p.read_text()

old = '''    ) AS columns(table_name, column_name)
  ALTER TABLE "service_plans" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL;
  CREATE INDEX IF NOT EXISTS "service_plans_organization_id_idx" ON "service_plans"("organization_id");

  LOOP'''

new = '''    ALTER TABLE "service_plans" ADD COLUMN IF NOT EXISTS "organization_id" TEXT NOT NULL;
    CREATE INDEX IF NOT EXISTS "service_plans_organization_id_idx" ON "service_plans"("organization_id");
    ) AS columns(table_name, column_name)
  LOOP
'''

if old in content:
    content = content.replace(old, new, 1)
    p.write_text(content)
    print("SUCCESS")
else:
    print("NOT FOUND")
    # Show lines 94-101
    lines = content.split('\\n')
    for i in range(93, 102):
        if i < len(lines):
            print(f"{i+1}: {repr(lines[i])}")