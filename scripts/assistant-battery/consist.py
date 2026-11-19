import json,re,sys,collections
r=json.load(open(sys.argv[1])); g=collections.defaultdict(list)
for x in r: g[x['name']].append(x)
def nums(x):
    t=x['turns'][-1]; out=set()
    for s in t['sqls'][-1:]:
        for row in s['head']:
            for v in row.values():
                if isinstance(v,(int,float)): out.add(round(float(v),1))
                elif isinstance(v,str) and re.fullmatch(r'-?\d+(\.\d+)?',v): out.add(round(float(v),1))
    return out
for n,xs in g.items():
    ns=[nums(x) for x in xs]; common=set.intersection(*ns) if ns else set()
    diff=[sorted(a-common)[:8] for a in ns]
    flag='OK  ' if not any(diff) else 'DIFF'
    print(flag,n); 
    if flag=='DIFF' or '-v' in sys.argv:
        for x,d in zip(xs,diff):
            t=x['turns'][-1]; print('    only-here:',d,'| nq',len(t['sqls'])); print('    A:',t['answer'][:330].replace('\n',' ')); print('    SQL:',' '.join((t['sqls'][-1]['sql'] if t['sqls'] else '').split())[:420])
