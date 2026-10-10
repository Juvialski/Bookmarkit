"""Create reviewable SQL import batches for the authorized Supabase connector."""
import json
from pathlib import Path
from catalog_publish import payloads
root = Path(__file__).resolve().parent.parent / 'dist/catalog/sql'
root.mkdir(parents=True,exist_ok=True)
keys={'catalog_works':['id'],'catalog_authors':['id'],'catalog_work_authors':['work_id','author_id'],'catalog_editions':['id'],'catalog_isbns':['isbn13'],'catalog_ratings':['work_id','source']}
index=0
for table,rows in payloads():
    for offset in range(0,len(rows),500):
        values=rows[offset:offset+500]
        encoded=json.dumps(values,ensure_ascii=False).replace("'","''")
        update=','.join(f'{column}=excluded.{column}' for column in values[0] if column not in keys[table])
        conflict='do update set '+update if update else 'do nothing'
        sql=f"insert into public.{table} select * from jsonb_populate_recordset(null::public.{table},'{encoded}'::jsonb) on conflict({','.join(keys[table])}) {conflict};"
        (root/f'{index:04}.sql').write_text(sql,encoding='utf-8');index+=1
print(index,'batches')
