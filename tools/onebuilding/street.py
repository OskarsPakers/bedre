# Panoramax (open API, CC BY-SA 4.0) + KartaView (open API) street-level photos near the Opera -> ref/street + sources-street.json. No tokens used. Polite: 1.5 s between downloads.
import json,urllib.request,time,os,sys
UA="Mozilla/5.0 (research client; low-rate)"
def dl(url,fn):
    if os.path.exists(fn) and os.path.getsize(fn)>0: return True
    try:
        time.sleep(1.5); open(fn,'wb').write(urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":UA}),timeout=60).read()); return True
    except Exception as e: print('fail',url,e); return False
src=[]
for f in json.load(open('pnx.json'))['features']:
    a=f['assets']; k='sd' if 'sd' in a else list(a)[0]; fn='street/pnx_'+f['id'][:8]+'.jpg'
    if dl(a[k]['href'],fn): src.append({"source":"Panoramax","id":f['id'],"file":fn,"datetime":f['properties']['datetime'],"licence":f['properties'].get('license'),"author":f['properties'].get('geovisio:producer'),"lonlat":f['geometry']['coordinates'],"azimuth":f['properties'].get('view:azimuth')})
for p in json.load(open('kv.json'))['result']['data']:
    fn='street/kv_'+p['id']+'.jpg'
    if dl(p['fileurlProc'],fn): src.append({"source":"KartaView","id":p['id'],"file":fn,"datetime":p['shotDate'],"licence":"CC BY-SA 4.0 per KartaView terms (re-verify)","author":"KartaView contributor","lonlat":[float(p['lng']),float(p['lat'])],"azimuth":p['heading']})
json.dump(src,open('street/sources-street.json','w'),indent=1); print(len(src))
