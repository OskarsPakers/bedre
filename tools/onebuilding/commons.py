# Fetch metadata (author, licence) + 1280px thumbs for selected Commons files into the ref folder; writes sources.json. Polite: sequential, 1 s pause.
import json,sys,time,urllib.request,urllib.parse,os,re
UA="Mozilla/5.0 (research client; low-rate)"
out=sys.argv[1]; titles=[l.strip() for l in open(sys.argv[2]) if l.strip()]
res=[]
for t in titles:
    q=urllib.parse.urlencode({"action":"query","titles":t,"prop":"imageinfo","iiprop":"url|extmetadata|size","iiurlwidth":"1600","format":"json"})
    r=json.load(urllib.request.urlopen(urllib.request.Request("https://commons.wikimedia.org/w/api.php?"+q,headers={"User-Agent":UA})))
    p=list(r["query"]["pages"].values())[0]; ii=p["imageinfo"][0]; m=ii["extmetadata"]
    lic=m.get("LicenseShortName",{}).get("value","?"); au=re.sub("<[^>]+>","",m.get("Artist",{}).get("value","?"))
    fn=re.sub(r"[^A-Za-z0-9._-]+","_",t[5:])
    path=os.path.join(out,fn)
    if not os.path.exists(path):
        time.sleep(1.2); data=urllib.request.urlopen(urllib.request.Request(ii["thumburl"],headers={"User-Agent":UA})).read(); open(path,"wb").write(data)
    res.append({"file":fn,"title":t,"page":ii["descriptionurl"],"author":au,"licence":lic,"licenceUrl":m.get("LicenseUrl",{}).get("value",""),"orig":[ii["width"],ii["height"]],"date":re.sub("<[^>]+>","",m.get("DateTimeOriginal",{}).get("value",""))})
    print(fn,lic,au[:40])
json.dump(res,open(os.path.join(out,"sources.json"),"w"),indent=1,ensure_ascii=False)
