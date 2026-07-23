const DB_NAME = "mori-notes-db";
const DB_VERSION = 2;
const STORE = "notes";
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const supported = { pdf: "PDF", png: "图片", jpg: "图片", jpeg: "图片", webp: "图片", mp4: "视频", webm: "视频", txt: "文本", md: "Markdown", markdown: "Markdown" };

let db;
let notes = [];
let activeFilter = "all";
let activeView = "all";
let activeSpace = "all";
let currentNote = null;
let pendingFiles = [];
let pendingResolver = null;
let cloudMode = false;
const objectUrls = new Set();

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const escapeHtml = (value = "") => value.replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
const formatDate = value => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));
const inputDate = value => {const d=new Date(value||Date.now());const pad=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const displayRecordDate = value => {if(!value)return "";const [year,month,day]=value.split("-");return `${year}.${month}.${day}`};

const exampleNotes = [
  { id:"example-language", title:"日语里的温柔表达", type:"Markdown", category:"语言", tags:["日语","表达"], summary:"整理了几个适合日常使用、语气柔和的日语短句。", content:"# 日语里的温柔表达\n\n## おつかれさま\n不只是「辛苦了」，也是对彼此努力的温柔确认。\n\n> 言葉は小さいけれど、気持ちは大きい。\n\n## ゆっくりでいいよ\n慢慢来也没有关系。学习不必追赶别人的时钟。", importedAt:Date.now()-86400000, createdAt:Date.now()-86400000, favorite:true, progress:72, isExample:true },
  { id:"example-code", title:"JavaScript 数组小抄", type:"文本", category:"编程", tags:["JavaScript","基础"], summary:"map、filter 和 reduce 的使用场景与简单示例。", content:"JavaScript 数组方法小抄\n\nmap：将数组中的每一项转换成新的值。\nfilter：只留下满足条件的项目。\nreduce：把一组数据汇总成一个结果。\n\n学习提示：先明确想得到什么结果，再选择方法。", importedAt:Date.now()-172800000, createdAt:Date.now()-172800000, favorite:false, progress:45, isExample:true },
  { id:"example-reading", title:"《山茶文具店》阅读摘记", type:"Markdown", category:"阅读", tags:["阅读","摘抄"], summary:"写信是一种把心情慢慢安放下来的过程。", content:"# 《山茶文具店》\n\n在镰仓安静的小巷里，代笔人替人写下难以启齿的心意。\n\n> 有些话只有落在纸上，才终于听见自己的声音。\n\n## 今日感想\n认真选择纸张和墨水，本身就是对收信人的珍惜。", importedAt:Date.now()-259200000, createdAt:Date.now()-259200000, favorite:true, progress:100, isExample:true },
  { id:"example-idea", title:"夏日学习角落改造", type:"文本", category:"灵感", tags:["空间","灵感"], summary:"奶油色桌布、透明花瓶和一盏暖光小台灯。", content:"夏日学习角落 wish list\n\n□ 换一块轻薄的奶油色桌布\n□ 用透明瓶插两枝洋桔梗\n□ 收纳散落的充电线\n□ 傍晚打开暖色台灯\n\n空间变得舒服，心也会更愿意停下来。", importedAt:Date.now()-345600000, createdAt:Date.now()-345600000, favorite:false, progress:20, isExample:true }
];

function openDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const database=request.result;if(database.objectStoreNames.contains(STORE))database.deleteObjectStore(STORE);database.createObjectStore(STORE,{keyPath:"id"})};request.onsuccess=()=>{db=request.result;resolve(db)};request.onerror=()=>reject(request.error)})}
function storeAction(mode, value){return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");const store=tx.objectStore(STORE);const request=mode==="put"?store.put(value):mode==="delete"?store.delete(value):store.getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}

async function init(){
  document.body.classList.add("opening-active");
  const openingStartedAt=performance.now();
  updateClock(); setInterval(updateClock,60000); bindEvents();
  const cloud=await window.CloudApp?.init();cloudMode=!!cloud?.enabled;
  if(cloudMode&&!cloud.authenticated){$("#opening").remove();document.body.classList.remove("opening-active");$("#authGate").hidden=false;return}
  applyRoleUI();
  try{await openDB()}catch{}
  try{if(cloudMode){notes=await CloudApp.listNotes()}else{notes=await storeAction("get");await migrateSpaces()}renderAll()}
  catch(error){notes=[];renderAll();toast(cloudMode?"云端数据加载失败，请稍后重试":"当前浏览器无法持久保存，笔记仅在本次打开期间保留。")}
  const reducedMotion=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const minimumDuration=reducedMotion?150:1400;
  const remaining=Math.max(0,minimumDuration-(performance.now()-openingStartedAt));
  setTimeout(finishOpening,remaining);
}

function finishOpening(){const opening=$("#opening");if(!opening)return;opening.classList.add("finished");document.body.classList.remove("opening-active");setTimeout(()=>opening.remove(),window.matchMedia("(prefers-reduced-motion: reduce)").matches?180:1550)}
function applyRoleUI(){const admin=!cloudMode||CloudApp.isAdmin;$$('.admin-only').forEach(el=>el.hidden=!admin);$("#focusImport").hidden=!admin;$("#importZone").hidden=!admin;$("#heroImport").hidden=!admin;$("#logoutButton").hidden=!cloudMode;document.body.classList.toggle("viewer-mode",cloudMode&&!admin)}

function updateClock(){const now=new Date();const hour=now.getHours();$("#greeting").textContent=`${hour<11?"早上":hour<18?"下午":"晚上"}好，Exquisite_xinxin`;$("#todayText").textContent=new Intl.DateTimeFormat("zh-CN",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(now)}
function initTodos(){const defaults=[{text:"复习 20 个日语单词",done:true},{text:"读书 30 分钟",done:false},{text:"整理今天的课堂笔记",done:false}];let todos=JSON.parse(localStorage.getItem("mori-todos")||"null")||defaults;const render=()=>{$("#todoList").innerHTML=todos.map((t,i)=>`<label class="todo ${t.done?"done":""}"><input type="checkbox" data-todo="${i}" ${t.done?"checked":""}><span>${escapeHtml(t.text)}</span></label>`).join("");localStorage.setItem("mori-todos",JSON.stringify(todos))};$("#todoList").addEventListener("change",e=>{if(e.target.dataset.todo!==undefined){todos[+e.target.dataset.todo].done=e.target.checked;render()}});$("#addTodo").onclick=()=>{const text=prompt("写下一个今天想完成的小目标：");if(text?.trim()){todos.push({text:text.trim(),done:false});render()}};render()}

function bindEvents(){
  $("#loginForm").onsubmit=async e=>{e.preventDefault();const status=$("#loginStatus");status.textContent="正在发送…";try{await CloudApp.sendMagicLink($("#loginEmail").value.trim());status.textContent="登录链接已发送，请打开邮箱完成登录。"}catch(error){status.textContent=error.message}};
  window.addEventListener("storage-warning",e=>toast(`云端媒体预计已使用约 ${Math.round((e.detail.used+e.detail.incoming)/1024/1024)}MB，接近免费版 1GB 上限`));
  $("#logoutButton").onclick=()=>CloudApp.logout();$("#openSettings").onclick=openSettings;$("#closeSettings").onclick=()=>$("#settingsDialog").close();$("#inviteForm").onsubmit=inviteViewer;$("#startMigration").onclick=startMigration;
  $("#chooseFiles").onclick=$("#heroImport").onclick=()=>$("#fileInput").click(); $("#focusImport").onclick=()=>{$("#importZone").scrollIntoView({behavior:"smooth"});closeMobile()};
  $("#fileInput").onchange=e=>handleFiles([...e.target.files]);
  const zone=$("#importZone");["dragenter","dragover"].forEach(type=>zone.addEventListener(type,e=>{e.preventDefault();zone.classList.add("dragging")}));["dragleave","drop"].forEach(type=>zone.addEventListener(type,e=>{e.preventDefault();zone.classList.remove("dragging")}));zone.addEventListener("drop",e=>handleFiles([...e.dataTransfer.files]));zone.onkeydown=e=>{if(e.key==="Enter"||e.key===" ")$("#fileInput").click()};
  $("#searchInput").oninput=renderNotes; $("#sortSelect").onchange=renderNotes; $("#scrollNotes").onclick=()=>$("#notesSection").scrollIntoView({behavior:"smooth"});
  $("#filters").onclick=e=>{const btn=e.target.closest("button");if(!btn)return;activeFilter=btn.dataset.filter;$$('#filters button').forEach(b=>b.classList.toggle("active",b===btn));renderNotes()};
  $("#spaceGrid").onclick=e=>{const card=e.target.closest(".space-card");if(card)enterSpace(card.dataset.space)};
  $("#showAllSpaces").onclick=()=>enterSpace("all");
  $("#spaceGrid").onpointermove=e=>{const card=e.target.closest(".space-card");if(!card||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;const r=card.getBoundingClientRect();card.style.setProperty("--mx",`${(e.clientX-r.left)/r.width*100}%`);card.style.setProperty("--my",`${(e.clientY-r.top)/r.height*100}%`)};
  $("#spacePickerDialog").onclick=e=>{const button=e.target.closest("[data-pick-space]");if(button)resolveSpacePick(button.dataset.pickSpace)};$("#skipPendingFile").onclick=()=>resolveSpacePick(null);
  $("#spacePickerDialog").addEventListener("cancel",e=>{e.preventDefault();resolveSpacePick(null)});
  $$(".nav-item[data-view]").forEach(btn=>btn.onclick=()=>{activeView=btn.dataset.view;$$(".nav-item").forEach(b=>b.classList.toggle("active",b===btn));renderNotes();closeMobile()});
  $("#notesGrid").onclick=handleCardAction; $("#closeReader").onclick=()=>$("#readerDialog").close(); $("#readerFav").onclick=()=>currentNote&&toggleFavorite(currentNote.id,true); $("#editNote").onclick=openEditor;
  $("#readerContent").onscroll=e=>{if(!currentNote)return;const el=e.currentTarget;const progress=Math.min(100,Math.round(el.scrollTop/Math.max(1,el.scrollHeight-el.clientHeight)*100));$("#readerProgressBar").style.width=`${progress}%`;if(progress>currentNote.progress){currentNote.progress=progress;persist(currentNote,false)}};
  $("#editorForm").onsubmit=e=>e.preventDefault();$("#saveEdit").onclick=saveEditor;
  $("#mobileMenu").onclick=()=>{const open=$("#sidebar").classList.toggle("open");$("#mobileMenu").setAttribute("aria-expanded",open)};$("#themeButton").onclick=()=>{document.body.classList.toggle("dim");$("#themeButton").textContent=document.body.classList.contains("dim")?"☾":"☀"};
  window.addEventListener("beforeunload",()=>objectUrls.forEach(URL.revokeObjectURL));
}
function closeMobile(){$("#sidebar").classList.remove("open");$("#mobileMenu").setAttribute("aria-expanded","false")}

async function handleFiles(files){
  if(!files.length)return; let imported=0;
  pendingFiles=files;for(let fileIndex=0;fileIndex<files.length;fileIndex++){const file=files[fileIndex];
    const ext=file.name.split(".").pop().toLowerCase();
    if(!supported[ext]){toast(`${file.name}：暂不支持这种格式`);continue}
    if(file.size===0){toast(`${file.name}：文件内容为空`);continue}
    if(file.size>MAX_FILE_SIZE&&!confirm(`${file.name} 超过 50MB，导入可能占用较多空间。仍要继续吗？`))continue;
    const duplicate=notes.some(n=>n.fileName===file.name&&n.fileSize===file.size&&n.lastModified===file.lastModified);if(duplicate){toast(`${file.name} 已经导入过啦`);continue}
    try{const space=await askForSpace(file,fileIndex,files.length);if(!space)continue;const note=await fileToNote(file,ext,space);if(cloudMode){if(note.fileBlob){toast(`正在上传 ${file.name}…`);note.objectKey=await CloudApp.upload(file);note.mimeType=file.type}notes.unshift(await CloudApp.createNote(note))}else{notes.unshift(note);await persist(note,false)}imported++}catch(error){console.error(error);toast(`${file.name} 导入失败：${error.message}`)}
  }
  $("#fileInput").value="";renderAll();if(imported)toast(`成功收好 ${imported} 份新手记 ♡`);
}
function askForSpace(file,index,total){$("#pendingFileIndex").textContent=`${index+1} / ${total}`;$("#pendingFileName").textContent=file.name;$("#pendingFileType").textContent=`${supported[file.name.split(".").pop().toLowerCase()]} · ${(file.size/1024/1024).toFixed(2)} MB`;$("#spacePickerDialog").showModal();return new Promise(resolve=>pendingResolver=resolve)}
function resolveSpacePick(space){$("#spacePickerDialog").close();const resolve=pendingResolver;pendingResolver=null;resolve?.(space)}
async function fileToNote(file,ext,space){const isText=["txt","md","markdown"].includes(ext);const content=isText?await file.text():"";const category=guessCategory(file.name,content);return{id:uid(),title:file.name.replace(/\.[^.]+$/,"").slice(0,80),type:supported[ext],category,space,recordDate:inputDate(file.lastModified||Date.now()),tags:[category,"手记导入"],summary:isText?content.replace(/[#>*_`\[\]-]/g," ").replace(/\s+/g," ").trim().slice(0,100):`${supported[ext]} 手记 · ${(file.size/1024/1024).toFixed(1)} MB`,content,fileBlob:isText?null:file,fileName:file.name,fileSize:file.size,lastModified:file.lastModified,importedAt:Date.now(),createdAt:file.lastModified||Date.now(),favorite:false,progress:0,isExample:false}}
function guessCategory(name,content){const text=(name+" "+content.slice(0,300)).toLowerCase();if(/日语|英语|单词|english|japanese|language/.test(text))return"语言";if(/代码|编程|javascript|python|css|html|code/.test(text))return"编程";if(/阅读|读书|书摘|reading|book/.test(text))return"阅读";return"灵感"}
async function persist(note,rerender=true){try{const saved=cloudMode?await CloudApp.updateNote(note):note;if(!cloudMode&&db)await storeAction("put",note);const i=notes.findIndex(n=>n.id===note.id);if(i>=0)notes[i]=saved;if(currentNote?.id===note.id)currentNote=saved;if(rerender)renderAll()}catch(error){toast(`保存失败：${error.message||"本地空间可能不足"}`)}}

async function migrateSpaces(){const changed=[];for(const note of notes){if(!note.space){note.space=note.category==="阅读"?"memory":["语言","编程"].includes(note.category)?"study":"life";changed.push(note)}}if(changed.length)await Promise.all(changed.map(note=>storeAction("put",note)))}
function renderAll(){renderNotes();renderStats();renderSpaceCounts()}
function filteredNotes(){const query=$("#searchInput").value.trim().toLowerCase();let list=notes.filter(n=>(activeSpace==="all"||n.space===activeSpace)&&(activeFilter==="all"||n.category===activeFilter)&&(activeView!=="favorites"||n.favorite)&&(!query||[n.title,n.summary,n.category,...(n.tags||[])].join(" ").toLowerCase().includes(query)));const sort=$("#sortSelect").value;return list.sort((a,b)=>sort==="oldest"?a.importedAt-b.importedAt:sort==="title"?a.title.localeCompare(b.title,"zh-CN"):b.importedAt-a.importedAt)}
function renderNotes(){const list=filteredNotes();$("#noteCount").textContent=String(list.length).padStart(2,"0");$("#notesGrid").innerHTML=list.map((n,i)=>noteCard(n,i)).join("");$("#emptyState").hidden=!!list.length}
function noteCard(n,i){let cover;if(n.type==="图片"&&n.fileBlob){const url=URL.createObjectURL(n.fileBlob);objectUrls.add(url);cover=`<div class="note-cover image"><img src="${url}" alt="${escapeHtml(n.title)} 的预览"></div>`}else if(n.type==="视频"&&n.fileBlob){const url=URL.createObjectURL(n.fileBlob);objectUrls.add(url);cover=`<div class="note-cover video"><video src="${url}" muted preload="metadata"></video><span class="play-mark">▶</span></div>`}else if(n.type==="PDF")cover=`<div class="note-cover pdf"><div class="pdf-sheet">${"<i></i>".repeat(6)}</div></div>`;else cover=`<div class="note-cover text">“${escapeHtml((n.content||n.summary).replace(/[#>*_`]/g,"").slice(0,90))}”</div>`;const dateBadge=n.space==="memory"&&["图片","视频"].includes(n.type)&&n.recordDate?`<span class="record-date">${displayRecordDate(n.recordDate)}</span>`:"";return `<article class="note-card" data-id="${n.id}" style="animation-delay:${Math.min(i,8)*45}ms"><span class="cover-label">${escapeHtml(n.category)} · ${escapeHtml(n.type)}</span>${dateBadge}${cover}<div class="note-body"><div class="note-meta"><span>${n.recordDate?displayRecordDate(n.recordDate):formatDate(n.importedAt)}</span><span>${n.isExample?"示例手记":"本地手记"}</span></div><h3>${escapeHtml(n.title)}</h3><p>${escapeHtml(n.summary||"还没有添加简介")}</p><div class="tags">${(n.tags||[]).map(t=>`<span class="tag"># ${escapeHtml(t)}</span>`).join("")}</div><div class="card-actions"><span class="read-progress"><i style="--progress:${n.progress||0}%"></i>${n.progress||0}%</span><span class="icon-actions"><button data-action="favorite" class="${n.favorite?"faved":""}" aria-label="收藏">${n.favorite?"♥":"♡"}</button><button data-action="delete" aria-label="删除">⌫</button></span></div></div></article>`}
function renderStats(){animateNumber($("#statTotal"),notes.length);animateNumber($("#statStudy"),notes.filter(n=>n.space==="study").length);animateNumber($("#statMemory"),notes.filter(n=>n.space==="memory").length);animateNumber($("#statLife"),notes.filter(n=>n.space==="life").length)}
function animateNumber(el,target){const start=Number(el.textContent)||0;let frame=0;const tick=()=>{frame++;el.textContent=Math.round(start+(target-start)*frame/18);if(frame<18)requestAnimationFrame(tick)};tick()}
function renderSpaceCounts(){for(const [space,label] of [["study","Study"],["memory","Memory"],["life","Life"]]){$(`#space${label}Count`).textContent=notes.filter(n=>n.space===space).length}}
function enterSpace(space){if(activeSpace===space)return;activeSpace=space;const grid=$("#spaceGrid");grid.classList.add("switching");setTimeout(()=>{grid.classList.toggle("focused",space!=="all");$$('.space-card').forEach(c=>c.classList.toggle("selected",c.dataset.space===space));$("#showAllSpaces").hidden=space==="all";const names={study:"研习间",memory:"拾光集",life:"日常里"};$(".notes-heading h2").firstChild.textContent=space==="all"?"最近的手记 ":`${names[space]}的手记 `;renderNotes();grid.classList.remove("switching");if(space!=="all")$("#notesSection").scrollIntoView({behavior:"smooth",block:"start"})},220)}

function handleCardAction(e){const card=e.target.closest(".note-card")||e.target.closest(".timeline-item");if(!card)return;const action=e.target.closest("button")?.dataset.action;if(action==="favorite"){e.stopPropagation();toggleFavorite(card.dataset.id);return}if(action==="delete"){e.stopPropagation();deleteNote(card.dataset.id);return}openReader(card.dataset.id)}
async function toggleFavorite(id,fromReader=false){const note=notes.find(n=>n.id===id);if(!note)return;note.favorite=!note.favorite;await persist(note);if(fromReader)$("#readerFav").textContent=note.favorite?"♥":"♡";toast(note.favorite?"已放进灵感收藏夹":"已取消收藏")}
async function deleteNote(id){const note=notes.find(n=>n.id===id);if(!note||!confirm(`确定删除「${note.title}」吗？此操作无法撤销。`))return;notes=notes.filter(n=>n.id!==id);if(db)await storeAction("delete",id);renderAll();toast("手记已删除")}

function openReader(id){currentNote=notes.find(n=>n.id===id);if(!currentNote)return;$("#readerType").textContent=`${currentNote.category} · ${currentNote.type}`;$("#readerTitle").textContent=currentNote.title;$("#readerMeta").textContent=`${formatDate(currentNote.importedAt)} 导入　·　${(currentNote.tags||[]).map(t=>"#"+t).join(" ")}`;$("#readerFav").textContent=currentNote.favorite?"♥":"♡";$("#readerProgressBar").style.width=`${currentNote.progress||0}%`;const content=$("#readerContent");content.onscroll=null;content.innerHTML="";
  if(currentNote.type==="PDF"&&currentNote.fileBlob){const url=URL.createObjectURL(currentNote.fileBlob);objectUrls.add(url);content.innerHTML=`<iframe src="${url}" title="${escapeHtml(currentNote.title)}"></iframe>`}
  else if(currentNote.type==="图片"&&currentNote.fileBlob){const url=URL.createObjectURL(currentNote.fileBlob);objectUrls.add(url);content.innerHTML=`<img src="${url}" alt="${escapeHtml(currentNote.title)}">`}
  else if(currentNote.type==="视频"&&currentNote.fileBlob){const url=URL.createObjectURL(currentNote.fileBlob);objectUrls.add(url);content.innerHTML=`<video class="memory-video" src="${url}" controls playsinline preload="metadata"></video>`}
  else if(currentNote.type==="Markdown")content.innerHTML=renderMarkdown(currentNote.content);
  else content.innerHTML=`<pre>${escapeHtml(currentNote.content||currentNote.summary)}</pre>`;
  $("#readerDialog").showModal();setTimeout(()=>{$("#readerContent").onscroll=e=>{const el=e.currentTarget;const progress=Math.min(100,Math.round(el.scrollTop/Math.max(1,el.scrollHeight-el.clientHeight)*100));$("#readerProgressBar").style.width=`${progress}%`;if(progress>(currentNote.progress||0)){currentNote.progress=progress;persist(currentNote,false)}}},0)
}
function renderMarkdown(raw=""){let html=escapeHtml(raw);html=html.replace(/^### (.+)$/gm,"<h3>$1</h3>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>").replace(/^&gt; (.+)$/gm,"<blockquote>$1</blockquote>").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/`([^`]+)`/g,"<code>$1</code>").replace(/^[-*] (.+)$/gm,"<li>$1</li>").replace(/(?:<li>.*<\/li>\n?)+/g,m=>`<ul>${m}</ul>`).replace(/\n{2,}/g,"</p><p>").replace(/\n/g,"<br>");return `<p>${html}</p>`}
function openEditor(){$("#editTitle").value=currentNote.title;$("#editCategory").value=currentNote.category;$("#editSpace").value=currentNote.space||"life";$("#editRecordDate").value=currentNote.recordDate||inputDate(currentNote.createdAt);$("#editTags").value=(currentNote.tags||[]).join(", ");$("#editSummary").value=currentNote.summary||"";$("#editorDialog").showModal()}
async function saveEditor(e){e.preventDefault();if(!$("#editTitle").value.trim())return;currentNote.title=$("#editTitle").value.trim();currentNote.category=$("#editCategory").value;currentNote.space=$("#editSpace").value;currentNote.recordDate=$("#editRecordDate").value||inputDate(currentNote.createdAt);currentNote.tags=$("#editTags").value.split(/[,，]/).map(t=>t.trim()).filter(Boolean).slice(0,8);currentNote.summary=$("#editSummary").value.trim();await persist(currentNote);$("#editorDialog").close();$("#readerTitle").textContent=currentNote.title;$("#readerType").textContent=`${currentNote.category} · ${currentNote.type}`;toast("手记信息已更新")}
function toast(message){const el=document.createElement("div");el.className="toast";el.textContent=message;$("#toastStack").append(el);setTimeout(()=>el.remove(),3200)}

// Cloud mode overrides keep the original offline experience available for local previews.
function renderNotes(){const list=filteredNotes();$("#noteCount").textContent=String(list.length).padStart(2,"0");const isMemory=activeSpace==="memory";$("#notesGrid").className='notes-grid'+(isMemory?" timeline-mode":"");$("#notesGrid").innerHTML=isMemory?list.map((n,i)=>timelineItem(n,i)).join(""):list.map((n,i)=>noteCard(n,i)).join("");$("#emptyState").hidden=!!list.length;loadCloudThumbnails()}
function noteCard(n,i){
  let cover;
  if(n.type==="图片"&&n.fileBlob){const url=URL.createObjectURL(n.fileBlob);objectUrls.add(url);cover=`<div class="note-cover image"><img src="${url}" alt="${escapeHtml(n.title)} 的预览"></div>`}
  else if(n.type==="视频"&&n.fileBlob){const url=URL.createObjectURL(n.fileBlob);objectUrls.add(url);cover=`<div class="note-cover video"><video src="${url}" muted preload="metadata"></video><span class="play-mark">▶</span></div>`}
  else if(n.cloud&&n.objectKey&&n.type==="图片")cover=`<div class="note-cover image cloud-media" data-cloud-image="${n.id}"><span>正在载入照片…</span></div>`;
  else if(n.cloud&&n.objectKey&&n.type==="视频")cover=`<div class="note-cover video"><span class="play-mark">▶</span></div>`;
  else if(n.type==="PDF")cover=`<div class="note-cover pdf"><div class="pdf-sheet">${"<i></i>".repeat(6)}</div></div>`;
  else cover=`<div class="note-cover text">“${escapeHtml((n.content||n.summary||"").replace(/[#>*_`]/g,"").slice(0,90))}”</div>`;
  const dateBadge=n.space==="memory"&&["图片","视频"].includes(n.type)&&n.recordDate?`<span class="record-date">${displayRecordDate(n.recordDate)}</span>`:"";
  const actions=!cloudMode||CloudApp.isAdmin?`<span class="icon-actions"><button data-action="favorite" class="${n.favorite?"faved":""}" aria-label="收藏">${n.favorite?"♥":"♡"}</button><button data-action="delete" aria-label="删除">⌫</button></span>`:"";
  return `<article class="note-card" data-id="${n.id}" style="animation-delay:${Math.min(i,8)*45}ms"><span class="cover-label">${escapeHtml(n.category)} · ${escapeHtml(n.type)}</span>${dateBadge}${cover}<div class="note-body"><div class="note-meta"><span>${n.recordDate?displayRecordDate(n.recordDate):formatDate(n.importedAt)}</span><span>${n.cloud?"云端手记":"本地手记"}</span></div><h3>${escapeHtml(n.title)}</h3><p>${escapeHtml(n.summary||"还没有添加简介")}</p><div class="tags">${(n.tags||[]).map(t=>`<span class="tag"># ${escapeHtml(t)}</span>`).join("")}</div><div class="card-actions"><span class="read-progress"><i style="--progress:${n.progress||0}%"></i>${n.progress||0}%</span>${actions}</div></div></article>`;
}
async function loadCloudThumbnails(){if(!cloudMode)return;for(const el of $$('[data-cloud-image]')){try{const url=await CloudApp.mediaUrl(el.dataset.cloudImage);el.innerHTML=`<img src="${url}" alt="云端照片" draggable="false">`}catch{el.textContent="照片暂时无法载入"}}
function timelineItem(n,i){
  let media;
  if(n.type==="图片"&&n.fileBlob){const url=URL.createObjectURL(n.fileBlob);objectUrls.add(url);media=`<img src="${url}" alt="${escapeHtml(n.title)}">`}
  else if(n.type==="视频"&&n.fileBlob){const url=URL.createObjectURL(n.fileBlob);objectUrls.add(url);media=`<video src="${url}" muted preload="metadata"></video><span class="mini-play">\u25b6</span>`}
  else if(n.cloud&&n.objectKey&&n.type==="图片"){const imgId='tl-img-'+n.id;setTimeout(async()=>{try{const el=document.getElementById(imgId);if(el){const url=await CloudApp.mediaUrl(n.id);el.innerHTML='<img src="'+url+'" alt="'+escapeHtml(n.title)+'" draggable="false">'}}catch(e){}},200);media='<span id="'+imgId+'" style="display:grid;place-items:center;height:100%;color:var(--muted);font-size:10px">\u8f7d\u5165\u4e2d\u2026</span>'}
  else if(n.cloud&&n.objectKey&&n.type==="视频")media=`<video muted preload="metadata"></video><span class="mini-play">\u25b6</span>`;
  else if(n.type==="PDF")media='<div class="pdf-sheet" style="width:60px;height:80px;margin:20px auto">'+"<i></i>".repeat(5)+'</div>';
  else media=`<span style="display:grid;place-items:center;height:100%;font:italic 13px Georgia,serif;color:var(--cocoa)">\u201c${escapeHtml((n.summary||"").slice(0,40))}\u201d</span>`;
  const dateStr=n.recordDate?displayRecordDate(n.recordDate):formatDate(n.importedAt);
  const actions=!cloudMode||CloudApp.isAdmin?`<span class="icon-actions"><button data-action="favorite" class="${n.favorite?"faved":""}" aria-label="\u6536\u85cf">${n.favorite?"\u2665":"\u2661"}</button><button data-action="delete" aria-label="\u5220\u9664">\u232b</button></span>`:"";
  return `<article class="timeline-item" data-id="${n.id}" style="animation-delay:${Math.min(i,8)*60}ms"><div class="timeline-date">${dateStr} \u00b7 ${escapeHtml(n.category)}</div><div class="timeline-body"><div class="timeline-image${n.type==="\u89c6\u9891"?" video-thumb":""}">${media}</div><div class="timeline-info"><h3>${escapeHtml(n.title)}</h3><p>${escapeHtml(n.summary||"\u8fd8\u6ca1\u6709\u6dfb\u52a0\u7b80\u4ecb")}</p><div class="timeline-meta"><span>${n.cloud?"\u2601 \u4e91\u7aef":"\u{1F4C1} \u672c\u5730"}</span><span>${n.progress||0}%</span>${actions}</div>${(n.tags||[]).length?`<div class="timeline-tags">${n.tags.map(t=>`<span class="tag"># ${escapeHtml(t)}</span>`).join("")}</div>`:""}</div></div></article>`;
}}
async function deleteNote(id){const note=notes.find(n=>n.id===id);if(!note||!confirm(`确定删除「${note.title}」吗？此操作无法撤销。`))return;try{if(cloudMode)await CloudApp.deleteNote(id);else if(db)await storeAction("delete",id);notes=notes.filter(n=>n.id!==id);renderAll();toast("手记已删除")}catch(error){toast(`删除失败：${error.message}`)}}
async function openReader(id){
  currentNote=notes.find(n=>n.id===id);if(!currentNote)return;$("#readerType").textContent=`${currentNote.category} · ${currentNote.type}`;$("#readerTitle").textContent=currentNote.title;$("#readerMeta").textContent=`${formatDate(currentNote.importedAt)} 导入　·　${(currentNote.tags||[]).map(t=>"#"+t).join(" ")}`;$("#readerFav").textContent=currentNote.favorite?"♥":"♡";$("#readerProgressBar").style.width=`${currentNote.progress||0}%`;$("#editNote").hidden=cloudMode&&!CloudApp.isAdmin;$("#readerFav").hidden=cloudMode&&!CloudApp.isAdmin;const content=$("#readerContent");content.onscroll=null;content.innerHTML="";
  let media=currentNote.fileBlob?URL.createObjectURL(currentNote.fileBlob):currentNote.objectKey?await CloudApp.mediaUrl(currentNote.id):null;if(media&&currentNote.fileBlob)objectUrls.add(media);
  if(currentNote.type==="PDF"&&media)content.innerHTML=`<iframe src="${media}" title="${escapeHtml(currentNote.title)}"></iframe>`;
  else if(currentNote.type==="图片"&&media)content.innerHTML=`<img src="${media}" alt="${escapeHtml(currentNote.title)}" draggable="false">`;
  else if(currentNote.type==="视频"&&media)content.innerHTML=`<video class="memory-video" src="${media}" controls controlsList="nodownload" disablePictureInPicture playsinline preload="metadata"></video>`;
  else if(currentNote.type==="Markdown")content.innerHTML=renderMarkdown(currentNote.content);
  else content.innerHTML=`<pre>${escapeHtml(currentNote.content||currentNote.summary)}</pre>`;
  $("#readerDialog").showModal();
}
async function openSettings(){
  if(!CloudApp.isAdmin)return;
  const account=CloudApp.user;
  $("#accountEmail").textContent=account?.email||"未知邮箱";
  $("#accountRole").textContent=account?.role==="admin"?"管理员":"访客";
  $("#settingsDialog").showModal();
  await Promise.all([renderInvites(),inspectMigration()]);
}
async function renderInvites(){try{const rows=await CloudApp.listInvites();$("#inviteList").innerHTML=rows.map(row=>`<div class="invite-row"><span><b>${escapeHtml(row.email)}</b><small>${row.role} · ${row.status}</small></span>${row.role==="admin"?"":`<button data-revoke="${escapeHtml(row.email)}">撤销</button>`}</div>`).join("");$$('[data-revoke]').forEach(btn=>btn.onclick=async()=>{await CloudApp.revoke(btn.dataset.revoke);renderInvites()})}catch(error){toast(error.message)}}
async function inviteViewer(e){e.preventDefault();try{await CloudApp.invite($("#inviteEmail").value.trim());$("#inviteEmail").value="";await renderInvites();toast("访客已加入邀请名单")}catch(error){toast(error.message)}}
async function readLocalNotes(){if(!db)await openDB();return storeAction("get")}
async function inspectMigration(){try{const local=await readLocalNotes();const bytes=local.reduce((sum,n)=>sum+(n.fileBlob?.size||0),0);$("#migrationSummary").textContent=local.length?`发现 ${local.length} 份本地手记，媒体约 ${(bytes/1024/1024).toFixed(1)} MB。迁移成功后仍保留本地副本。`:"当前浏览器没有需要迁移的本地手记。";$("#startMigration").disabled=!local.length}catch{$("#migrationSummary").textContent="无法读取本地手记。"}}
async function startMigration(){const local=await readLocalNotes();if(!local.length)return;const failures=[];const existing=new Set(notes.map(n=>n.fingerprint).filter(Boolean));$("#migrationProgress").hidden=false;$("#startMigration").disabled=true;for(let i=0;i<local.length;i++){const note=local[i];try{note.localId=note.id;note.fingerprint=await CloudApp.fingerprint(note);if(existing.has(note.fingerprint))continue;if(note.fileBlob){note.objectKey=await CloudApp.upload(note.fileBlob,p=>$("#migrationBar").style.width=`${Math.round((i+p/100)/local.length*100)}%`);note.mimeType=note.fileBlob.type}await CloudApp.createNote(note);existing.add(note.fingerprint)}catch(error){failures.push({note,error:error.message})}$("#migrationBar").style.width=`${Math.round((i+1)/local.length*100)}%`}notes=await CloudApp.listNotes();renderAll();$("#migrationFailures").innerHTML=failures.map(f=>`<p>${escapeHtml(f.note.title)}：${escapeHtml(f.error)}</p>`).join("");$("#migrationSummary").textContent=failures.length?`迁移完成，${failures.length} 项失败，可再次执行重试。`:"本地数据已成功迁移并完成云端读取验证。";$("#startMigration").disabled=false}
document.addEventListener("contextmenu",e=>{if(cloudMode&&e.target.closest("img,video"))e.preventDefault()});

init();
