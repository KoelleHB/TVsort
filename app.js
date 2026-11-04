'use strict';
const $=id=>document.getElementById(id);
const S={files:new Map(),channels:[],byId:new Map(),original:[],fav:[],history:[],xml:'',changed:0,loaded:false,drag:null};
const PAGE_SIZE=100;
const bridge={token:null,baseline:null,connected:false};
let libraryPage=0;
const required=['ChannelList/Favorite.xml','ChannelList/s2channellib/DVBS.xml','ChannelList/channelFile.bin','ChannelList/chanLst.bin'];
function status(s,err=false){let e=$('status');e.hidden=false;e.className=err?'status error':'status';e.textContent=s;}
function fail(s){throw Error(s);}
function decode(s){if(!s)return '';try{let a=s.trim().split(/\s+/).map(x=>{if(!/^0x[0-9a-f]{1,2}$/i.test(x))throw 0;return parseInt(x.slice(2),16)});if(a.length%2)return s;return new TextDecoder('utf-16le',{fatal:true}).decode(new Uint8Array(a)).replace(/\0+$/g,'');}catch{return s;}}
const tvServiceTypes=new Set([1,5,17,22,25,31,32]); // DVB television services; 2/10 are radio
function isTvService(value){if(value===null||value.trim()==='')return false;let n=Number(value);return Number.isInteger(n)&&tvServiceTypes.has(n);}
function parse(s,n){let d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))fail(n+' ist kein gültiges XML.');return d;}
function path(files,suffix){let a=[...files.keys()].filter(x=>x.endsWith('/ChannelMap_110/'+suffix)||x==='ChannelMap_110/'+suffix);if(a.length!==1)fail('Datei fehlt oder ist doppelt: '+suffix);return a[0];}
async function load(files){
 if(!files.size)fail('Keine Dateien gewählt.');
 if([...files.keys()].some(x=>x.includes('../')||x.startsWith('/')))fail('Ungültige Dateipfade.');
 let paths=required.map(x=>path(files,x)),prefix=paths[0].split('ChannelMap_110/')[0];
 if(!prefix.includes('PhilipsChannelMaps/')||paths.some(x=>!x.startsWith(prefix+'ChannelMap_110/')))fail('Bitte einen vollständigen PhilipsChannelMaps/ChannelMap_110-Export auswählen.');
 let [fv,sv]=await Promise.all([files.get(paths[0]).text(),files.get(paths[1]).text()]);
 let fdoc=parse(fv,'Favorite.xml'),sdoc=parse(sv,'DVBS.xml');
 if(fdoc.documentElement.tagName!=='FavoriteListMAP'||sdoc.documentElement.tagName!=='ChannelMap')fail('Philips-XML-Struktur nicht unterstützt.');
 let channels=[],byId=new Map();
 for(let c of sdoc.getElementsByTagName('Channel')){
   let a=c.getElementsByTagName('Setup')[0],b=c.getElementsByTagName('Broadcast')[0];
   if(!a||!b)continue;
   let uid=b.getAttribute('UniqueID');
   if(!uid||byId.has(uid))fail('Doppelte oder fehlende Sender-ID: '+uid);
   let ch={uid,name:decode(a.getAttribute('ChannelName'))||'(Unbenannt)',number:a.getAttribute('ChannelNumber')||'',
     scrambled:a.getAttribute('Scrambled'),locked:a.getAttribute('ChannelLock'),
     encrypted:a.hasAttribute('Scrambled')&&a.getAttribute('Scrambled')!=='0',parentalLocked:a.hasAttribute('ChannelLock')&&a.getAttribute('ChannelLock')!=='0',
     serviceType:b.getAttribute('ServiceType'),isTv:isTvService(b.getAttribute('ServiceType'))};
   channels.push(ch);byId.set(uid,ch);
 }
 if(!channels.length)fail('Keine Sender in DVBS.xml gefunden.');
 let list=[...fdoc.getElementsByTagName('FavoriteList')].filter(x=>x.getAttribute('Index')==='1');
 if(list.length!==1)fail('Favoritenliste 1 fehlt oder ist doppelt.');
 if([...list[0].children].some(x=>x.tagName!=='FavoriteChannel'))fail('Unbekannte Favoritenstruktur; Bearbeitung abgebrochen.');
 let fav=[];
 for(let c of list[0].getElementsByTagName('FavoriteChannel')){
   let uid=c.getElementsByTagName('UniqueID')[0]?.textContent?.trim(),num=Number(c.getElementsByTagName('FavNumber')[0]?.textContent?.trim());
   if(!byId.has(uid)||!Number.isInteger(num)||num<0)fail('Ungültiger Favorit: '+uid);
   fav.push({uid,num});
 }
 fav.sort((a,b)=>a.num-b.num);
 if(new Set(fav.map(x=>x.uid)).size!==fav.length||fav.some((x,i)=>x.num!==i))fail('Doppelte IDs oder lückenhafte Favoritennummern.');
 Object.assign(S,{files,channels,byId,xml:fv,original:fav.map(x=>x.uid),fav:fav.map(x=>x.uid),history:[],changed:0,loaded:true,drag:null});
 $('total').textContent=channels.length.toLocaleString('de-DE');$('favname').textContent=decode(list[0].getAttribute('Name'))||'Fav1';
 $('filecount').textContent=files.size;
 $('encryptedcount').textContent=channels.filter(x=>x.encrypted).length.toLocaleString('de-DE');
 $('lockedcount').textContent=channels.filter(x=>x.parentalLocked).length.toLocaleString('de-DE');
 $('filterEncrypted').checked=true;$('filterLocked').checked=true;$('filterTv').checked=true;
 $('tvcount').textContent=channels.filter(x=>x.isTv).length.toLocaleString('de-DE');
 $('export').disabled=false;$('search').value='';libraryPage=0;render();
 status('Import erfolgreich: '+channels.length+' Sender, '+fav.length+' Favoriten. Alle Dateien bleiben lokal.');
}
async function importFolder(list){let m=new Map();for(let file of list)m.set(file.webkitRelativePath.replaceAll('\\','/'),{text:()=>file.text(),bytes:()=>file.arrayBuffer()});await load(m);}
async function importZip(file){
 if(typeof JSZip==='undefined')fail('Für ZIP wird JSZip benötigt. Internetverbindung prüfen oder Ordnerimport verwenden.');
 let zip=await JSZip.loadAsync(file),m=new Map();
 for(let [p,v] of Object.entries(zip.files))if(!v.dir)m.set(p,{text:()=>v.async('string'),bytes:()=>v.async('arraybuffer')});
 await load(m);
}
function mutate(fn){S.history.push([...S.fav]);if(S.history.length>80)S.history.shift();fn();S.changed++;render();}
function btn(text,title,enabled,fn){let b=document.createElement('button');b.className='iconbtn';b.textContent=text;b.title=title;b.setAttribute('aria-label',title);b.disabled=!enabled;b.onclick=fn;return b;}
function render(){
 $('favcount').textContent=S.fav.length;$('changes').textContent=S.changed;$('undo').disabled=!S.history.length;
 $('reset').disabled=S.original.join('|')===S.fav.join('|');
 let term=$('search').value.toLocaleLowerCase('de').trim(),chosen=new Set(S.fav);
 let hideEncrypted=$('filterEncrypted').checked,hideLocked=$('filterLocked').checked,onlyTv=$('filterTv').checked;
 let found=S.channels.filter(x=>(!hideEncrypted||!x.encrypted)&&(!hideLocked||!x.parentalLocked)&&(!onlyTv||x.isTv)&&
   (x.name.toLocaleLowerCase('de').includes(term)||x.number.includes(term)));
 const totalPages=Math.max(1,Math.ceil(found.length/PAGE_SIZE));
 libraryPage=Math.min(libraryPage,totalPages-1);
 const from=libraryPage*PAGE_SIZE;
 $('allfoot').textContent=found.length.toLocaleString('de-DE')+' Treffer · '+(found.length?from+1:0)+'–'+Math.min(from+PAGE_SIZE,found.length)+' sichtbar';
 $('pageInfo').textContent='Seite '+(libraryPage+1)+' von '+totalPages;
 $('previousPage').disabled=libraryPage===0;
 $('nextPage').disabled=libraryPage>=totalPages-1;
 let a=$('all');a.replaceChildren();
 for(let c of found.slice(from,from+PAGE_SIZE)){
   let row=document.createElement('div');row.className='item';
   let number=document.createElement('span');number.className='number';number.textContent='#'+c.number;
   let name=document.createElement('span');name.className='name';name.textContent=c.name;
   let add=btn(chosen.has(c.uid)?'✓':'+','Sender hinzufügen: '+c.name,!chosen.has(c.uid),()=>mutate(()=>S.fav.push(c.uid)));
   row.append(number,name,add);a.append(row);
 }
 if(!a.children.length)a.innerHTML='<div class="empty">Keine Treffer.</div>';
 let f=$('favorites');f.replaceChildren();
 S.fav.forEach((uid,i)=>{
   let c=S.byId.get(uid),row=document.createElement('div');row.className='item';row.draggable=true;
   let position=document.createElement('span');position.className='pos';position.textContent=i+1;
   let name=document.createElement('span');name.className='name';name.textContent=c.name;
   let number=document.createElement('span');number.className='number';number.textContent='#'+c.number;
   let up=btn('↑','Nach oben',i>0,()=>mutate(()=>{[S.fav[i-1],S.fav[i]]=[S.fav[i],S.fav[i-1]]}));
   let down=btn('↓','Nach unten',i<S.fav.length-1,()=>mutate(()=>{[S.fav[i+1],S.fav[i]]=[S.fav[i],S.fav[i+1]]}));
   let del=btn('×','Entfernen',true,()=>mutate(()=>S.fav.splice(i,1)));del.classList.add('danger');
   row.append(position,name,number,up,down,del);
   row.addEventListener('dragstart',e=>{S.drag=uid;e.dataTransfer.setData('text/plain',uid);e.dataTransfer.effectAllowed='move';row.classList.add('dragging')});
   row.addEventListener('dragend',()=>{S.drag=null;document.querySelectorAll('.dragover').forEach(x=>x.classList.remove('dragover'));row.classList.remove('dragging')});
   row.addEventListener('dragover',e=>{if(S.drag&&S.drag!==uid){e.preventDefault();row.classList.add('dragover')}});
   row.addEventListener('dragleave',()=>row.classList.remove('dragover'));
   row.addEventListener('drop',e=>{e.preventDefault();row.classList.remove('dragover');let from=S.fav.indexOf(S.drag),to=S.fav.indexOf(uid);if(from<0||to<0||from===to)return;mutate(()=>{let x=S.fav.splice(from,1)[0];S.fav.splice(to,0,x)})});
   f.append(row);
 });
 if(!f.children.length)f.innerHTML='<div class="empty">Keine Favoriten. Links Sender hinzufügen.</div>';
}
function createXml(){
 if(S.original.join('|')===S.fav.join('|'))return S.xml;
 let regex=/<FavoriteList\b(?=[^>]*\bIndex\s*=\s*["']1["'])[^>]*>/g,all=[...S.xml.matchAll(regex)];
 if(all.length!==1)fail('Favoritenliste 1 nicht eindeutig in Original-XML.');
 let from=all[0].index+all[0][0].length,to=S.xml.indexOf('</FavoriteList>',from);
 if(to<0)fail('FavoriteList-Ende fehlt.');
 let body=S.xml.slice(from,to),pattern=/<FavoriteChannel\b[^>]*>[\s\S]*?<\/FavoriteChannel>/g;
 if([...body.matchAll(pattern)].length!==S.original.length||body.replace(pattern,'').trim())fail('Unerwartete Favoritenstruktur.');
 let eol=S.xml.includes('\r\n')?'\r\n':'\n',indent=body.match(/\r?\n([ \t]*)<FavoriteChannel/)?.[1]||'    ',inner=indent+'  ';
 let entries=S.fav.map((uid,i)=>indent+'<FavoriteChannel>'+eol+inner+'<UniqueID>'+uid+'</UniqueID>'+eol+inner+'<FavNumber>'+i+'</FavNumber>'+eol+indent+'</FavoriteChannel>');
 let result=S.xml.slice(0,from)+eol+(entries.length?entries.join(eol)+eol:'')+indent.slice(0,-2)+S.xml.slice(to);
 let d=parse(result,'Export'),list=[...d.getElementsByTagName('FavoriteList')].find(x=>x.getAttribute('Index')==='1');
 let ids=[...list.getElementsByTagName('FavoriteChannel')].map(x=>x.getElementsByTagName('UniqueID')[0]?.textContent);
 if(ids.join('|')!==S.fav.join('|'))fail('Exportprüfung fehlgeschlagen.');
 return result;
}
async function makeExportBlob(){
 if(typeof JSZip==='undefined')fail('JSZip ist nicht verfügbar. Internetverbindung prüfen.');
 if(new Set(S.fav).size!==S.fav.length||S.fav.some(x=>!S.byId.has(x)))fail('Ungültige Favoriten.');
 let favorite=path(S.files,required[0]),xml=createXml(),zip=new JSZip();
 for(let [p,v] of S.files)zip.file(p,p===favorite?xml:await v.bytes());
 return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
}
async function exportAll(){
 let blob=await makeExportBlob();
 let u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='TVsort-PhilipsChannelMaps-ChannelMap_110.zip';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);
 status('Export erstellt: '+S.files.size+' Dateien. Unverändertes Originalbackup behalten! Der TV-Rückimport wurde noch nicht verifiziert.');
}
function error(e){console.error(e);status(e.message||String(e),true);}
$('folder').onchange=async e=>{try{if(e.target.files.length)await importFolder(e.target.files)}catch(x){error(x)}finally{e.target.value=''}};
$('zipfile').onchange=async e=>{try{if(e.target.files.length)await importZip(e.target.files[0])}catch(x){error(x)}finally{e.target.value=''}};
$('search').oninput=()=>{libraryPage=0;if(S.loaded)render()};
$('previousPage').onclick=()=>{if(libraryPage>0){libraryPage--;render();$('all').scrollTop=0}};
$('nextPage').onclick=()=>{libraryPage++;render();$('all').scrollTop=0};
$('filterEncrypted').onchange=()=>{libraryPage=0;if(S.loaded)render()};
$('filterLocked').onchange=()=>{libraryPage=0;if(S.loaded)render()};
$('filterTv').onchange=()=>{libraryPage=0;if(S.loaded)render()};
$('undo').onclick=()=>{if(!S.history.length)return;S.fav=S.history.pop();S.changed++;render()};
$('reset').onclick=()=>mutate(()=>{S.fav=[...S.original]});
$('export').onclick=async()=>{try{$('export').disabled=true;await exportAll()}catch(x){error(x)}finally{$('export').disabled=!S.loaded}};

async function bridgeRequest(endpoint, options={}){
 const headers={'X-TVsort-Token':bridge.token,...(options.headers||{})};
 const result=await fetch('/api/'+endpoint,{method:'POST',headers,...options,cache:'no-store'});
 if(!result.ok){
   let message='Fehler '+result.status;
   try{message=(await result.json()).error||message}catch{}
   throw Error(message);
 }
 return result;
}
async function initBridge(){
 if(!['localhost','127.0.0.1'].includes(window.location.hostname))return;
 try{
   const response=await fetch('/api/status',{cache:'no-store'});
   if(!response.ok)return;
   const data=await response.json();
   bridge.token=data.token;bridge.connected=!!data.connected;
   $('bridgePanel').hidden=false;
   $('bridgeState').textContent=data.connected?'ADB verbunden · USB '+data.volume:'ADB/USB nicht bereit: '+(data.error||'Unbekannt');
   for(const id of ['bridgeLoad','bridgeBackup'])$(id).disabled=!data.connected;
   $('bridgeApply').disabled=!data.connected||!S.loaded;
 }catch(err){console.debug('Bridge nicht verfügbar:',err);}
}
async function bridgeBusy(button, task){
 button.disabled=true;
 try{await task()}catch(err){error(err)}
 finally{await initBridge();}
}
$('bridgeLoad').onclick=()=>bridgeBusy($('bridgeLoad'),async()=>{
 if(S.loaded&&S.original.join('|')!==S.fav.join('|')&&!confirm('Ungespeicherte Änderungen verwerfen und USB-Export neu laden?'))return;
 status('Lese USB-Export via ADB und erstelle Backup …');
 const response=await bridgeRequest('load');
 const blob=await response.blob();
 await importZip(new File([blob],'PhilipsChannelMaps.zip',{type:'application/zip'}));
 bridge.baseline=response.headers.get('X-TVsort-Baseline');
 $('bridgeApply').disabled=false;
 status('USB-Export geladen. Originalbackup wurde lokal auf dem Chromebook gespeichert.');
});
$('bridgeBackup').onclick=()=>bridgeBusy($('bridgeBackup'),async()=>{
 status('Sichere USB-Senderliste via ADB …');
 const response=await bridgeRequest('backup');
 const data=await response.json();
 status('Backup erfolgreich erstellt: '+data.backup);
});
$('bridgeApply').onclick=()=>bridgeBusy($('bridgeApply'),async()=>{
 if(!S.loaded||!bridge.baseline)fail('Bitte zuerst mit „Vom USB laden“ die aktuelle Senderliste öffnen.');
 if(S.fav.join('|')===S.original.join('|'))fail('Keine Favoritenänderung vorhanden.');
 if(!confirm('TVsort schreibt ausschließlich Favorite.xml auf den USB-Stick. Zuvor wird die komplette Senderliste gesichert. Danach musst du am Philips manuell importieren. Jetzt fortfahren?'))return;
 status('Prüfe und sichere USB-Export, anschließend Favoriten übertragen …');
 const blob=await makeExportBlob();
 const response=await bridgeRequest('apply',{body:blob,headers:{
   'Content-Type':'application/zip',
   'X-TVsort-Baseline':bridge.baseline,
   'X-TVsort-Confirm':'JA'
 }});
 const data=await response.json();
 bridge.baseline=null;
 $('bridgeApply').disabled=true;
 status(data.message+'\nBitte jetzt am Fernseher: Senderliste kopieren → Auf Fernseher kopieren.');
});
initBridge();
