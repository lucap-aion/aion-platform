"""Consistency battery for the two assistants (admin analyst + brand sales-floor).

Every wrong number this assistant has given was a definition it improvised, and
none of them threw. This asks the DEPLOYED function real metric questions, each
several times in fresh conversations, and checks the answers against figures
computed by direct SQL (says / avoids); consist.py then flags any question whose
runs disagree with each other.

  SUPABASE_ACCESS_TOKEN=<management token> SSL_CERT_FILE=/etc/ssl/cert.pem \
    python3 scripts/assistant-battery/battery.py <project-ref> scripts/assistant-battery/cases_dev.json out.json
  python3 scripts/assistant-battery/consist.py out.json

Signs in with a magic link (generate_link + verify) as the "as" user of each case;
the default is the admin in ADMIN_EMAIL. Expected numbers are DEV's on 2026-11-19 —
recompute them before trusting a failure, sales keep landing.
"""
import json,sys,os,urllib.request,re,concurrent.futures as cf
ADMIN=os.environ.get("ADMIN_EMAIL","");
PAT=os.environ["SUPABASE_ACCESS_TOKEN"]; REF=sys.argv[1]; CASES=json.load(open(sys.argv[2])); OUT=sys.argv[3]
URL=f"https://{REF}.supabase.co"
def http(url,data=None,headers={},raw=False):
    h={"User-Agent":"curl/8.4.0","Content-Type":"application/json",**headers}
    r=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers=h)
    resp=urllib.request.urlopen(r,timeout=400)
    return resp if raw else json.load(resp)
keys=http(f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true",headers={"Authorization":f"Bearer {PAT}"})
k={x["name"]:x["api_key"] for x in keys}; SR=k["service_role"]; ANON=k["anon"]
toks={}
def token(email):
    if email not in toks:
        link=http(f"{URL}/auth/v1/admin/generate_link",{"type":"magiclink","email":email},{"Authorization":f"Bearer {SR}","apikey":SR})
        toks[email]=http(f"{URL}/auth/v1/verify",{"type":"magiclink","token_hash":link["hashed_token"]},{"apikey":ANON})["access_token"]
    return toks[email]
def ask(tok,q,history,extra):
    resp=http(f"{URL}/functions/v1/brand-assistant",{"question":q,"history":history,"locale":"en",**extra},{"Authorization":f"Bearer {tok}","apikey":ANON,"Accept":"text/event-stream","Origin":"https://dev.aioncover.com"},raw=True)
    ev=None; summary=""; sqls=[]; errs=[]
    for line in resp:
        line=line.decode().rstrip("\n")
        if line.startswith("event:"): ev=line[6:].strip()
        elif line.startswith("data:"):
            try: d=json.loads(line[5:])
            except Exception: continue
            if ev=="turn_start": summary=""
            elif ev=="text_delta": summary+=d.get("text","")
            elif ev=="sql_result": sqls.append(d)
            elif ev=="error": errs.append(d)
    return summary,sqls,errs
def norm(t): return re.sub(r'(?<=\d)[,.](?=\d{3}\b)','',t)
def who(case):
    # "as": "BRAND_USER" = the house login in BRAND_USER_EMAIL; absent = the admin.
    return os.environ["BRAND_USER_EMAIL"] if case.get("as")=="BRAND_USER" else case.get("as") or ADMIN
def run(case):
    tok=token(who(case)); history=[]; turns=[]
    for q in case["turns"]:
        try: summary,sqls,errs=ask(tok,q,history,case.get("extra",{}))
        except Exception as e: summary,sqls,errs="",[],[str(e)]
        shown=None
        for d in sqls:
            if shown is None or d.get("show") or not shown.get("show"): shown=d
        turns.append({"q":q,"answer":summary,"sqls":[{"sql":d.get("sql"),"rows":d.get("row_count"),"show":d.get("show"),"head":d.get("rows",[])[:2]} for d in sqls],"shown_rows":shown.get("row_count") if shown else None,"errs":errs})
        history+=[{"role":"user","content":q},{"role":"assistant","content":summary}]
    last=norm(turns[-1]["answer"]); allsql=" ".join((x["sql"] or "") for t in turns for x in t["sqls"]).lower()
    fails=[]
    for pat in case.get("says",[]):
        if not re.search(pat,last,re.I): fails.append("missing "+pat)
    for pat in case.get("avoids",[]):
        if re.search(pat,last,re.I): fails.append("has "+pat)
    for pat in case.get("sql_avoids",[]):
        if re.search(pat,allsql): fails.append("sql has "+pat)
    if "min_shown" in case and (turns[-1]["shown_rows"] or 0)<case["min_shown"]: fails.append("shown table rows=%s"%turns[-1]["shown_rows"])
    if any(t["errs"] for t in turns): fails.append("errors")
    if not last.strip(): fails.append("empty answer")
    return {"name":case["name"],"fails":fails,"turns":turns}
jobs=[c for c in CASES for _ in range(c.get("runs",2))]
for e in {who(c) for c in CASES}: token(e)
with cf.ThreadPoolExecutor(6) as ex: res=list(ex.map(run,jobs))
json.dump(res,open(OUT,"w"),ensure_ascii=False,indent=1)
for r in res: print(("PASS" if not r["fails"] else "FAIL"),r["name"],r["fails"])
print(sum(1 for r in res if not r["fails"]),"/",len(res))
