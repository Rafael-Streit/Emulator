import { ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ArcadeGame, ArcadeState, ArcadeStorageService, ConsoleSystem } from './arcade-storage.service';

type FilterMode = 'pixel' | 'soft' | 'crt';
type DsLayout = 'stacked' | 'top' | 'touch';
type ControlPreset = 'classic' | 'wasd' | 'custom';
interface ArcadeKeys { up:string; down:string; left:string; right:string; a:string; b:string; start:string; select:string }

@Component({
  selector: 'app-root', standalone: true,
  templateUrl: './app.component.html', styleUrl: './app.component.css'
})
export class AppComponent implements OnInit, OnDestroy {
  @ViewChild('playerFrame', { static: true }) private playerFrame!: ElementRef<HTMLIFrameElement>;
  @ViewChild('screenBezel', { static: true }) private screenBezel!: ElementRef<HTMLElement>;
  @ViewChild('stateImport') private stateImport?: ElementRef<HTMLInputElement>;
  readonly systems = [
    { id: 'gb' as ConsoleSystem, name: 'Game Boy', detail: 'GB · GBC', chip: '01' },
    { id: 'gba' as ConsoleSystem, name: 'Game Boy Advance', detail: 'GBA', chip: '02' },
    { id: 'nds' as ConsoleSystem, name: 'Nintendo DS', detail: 'NDS · Touchscreen', chip: '03' },
    { id: '3ds' as ConsoleSystem, name: 'Nintendo 3DS', detail: '3DS · Azahar', chip: '04' }
  ];
  readonly keyBindings: { id: keyof ArcadeKeys; label: string }[] = [{id:'up',label:'Oben'},{id:'down',label:'Unten'},{id:'left',label:'Links'},{id:'right',label:'Rechts'},{id:'a',label:'A'},{id:'b',label:'B'},{id:'start',label:'Start'},{id:'select',label:'Select'}];
  games: ArcadeGame[] = [];
  states: ArcadeState[] = [];
  activeGame: ArcadeGame | null = null;
  selectedSystem: ConsoleSystem = 'gb';
  selectedName = '';
  checksum = '';
  errorMessage = '';
  successMessage = '';
  settingsStatus = '';
  isPlaying = false;
  isLibraryOpen = false;
  isSettingsOpen = false;
  isStatesOpen = false;
  isFullscreen = false;
  showEjsToolbar = false;
  emulatorReady = false;
  isFileDragging = false;
  filterMode: FilterMode = 'pixel';
  dsLayout: DsLayout = 'stacked';
  controlPreset: ControlPreset = 'classic';
  customKeys: ArcadeKeys = {up:'up arrow',down:'down arrow',left:'left arrow',right:'right arrow',a:'x',b:'z',start:'enter',select:'shift'};
  aspectRatio = '4:3';
  selectedSlot = 1;
  renameId = '';
  renameDraft = '';
  installAvailable = false;
  private installPrompt: Event | null = null;
  private romUrl: string | null = null;
  private stateUrl: string | null = null;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private dragDepth = 0;
  private readonly beforeInstall = (event: Event) => {
    event.preventDefault(); this.installPrompt = event; this.installAvailable = true; this.cd.markForCheck();
  };
  private readonly messageListener = (event: MessageEvent) => this.onEmulatorMessage(event);
  private readonly fullscreenListener = () => {
    this.isFullscreen = document.fullscreenElement === this.screenBezel.nativeElement; this.cd.markForCheck();
  };

  constructor(private storage: ArcadeStorageService, private cd: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    addEventListener('message', this.messageListener);
    addEventListener('beforeinstallprompt', this.beforeInstall);
    document.addEventListener('fullscreenchange', this.fullscreenListener);
    void (navigator.storage?.persist?.() ?? Promise.resolve(false)).catch(()=>false);
    try {
      const [games, filter, layout, controls, aspect, customKeys] = await Promise.all([
        this.storage.getGames(), this.storage.getSetting<FilterMode>('filter', 'pixel'),
        this.storage.getSetting<DsLayout>('ds-layout', 'stacked'),
        this.storage.getSetting<ControlPreset>('controls', 'classic'),
        this.storage.getSetting<string>('aspect', '4:3'),
        this.storage.getSetting<ArcadeKeys>('custom-keys', {up:'up arrow',down:'down arrow',left:'left arrow',right:'right arrow',a:'x',b:'z',start:'enter',select:'shift'})
      ]);
      this.games = games.sort((a,b) => b.lastPlayedAt-a.lastPlayedAt);
      this.filterMode=filter; this.dsLayout=layout; this.controlPreset=controls; this.aspectRatio=aspect; this.customKeys=customKeys;
    } catch { this.errorMessage='Der lokale Bibliotheksspeicher ist nicht verfügbar.'; }
    this.cd.markForCheck();
  }
  ngOnDestroy(): void {
    removeEventListener('message', this.messageListener); removeEventListener('beforeinstallprompt', this.beforeInstall);
    document.removeEventListener('fullscreenchange', this.fullscreenListener);
    if (this.playTimer) clearInterval(this.playTimer); this.revokeUrls();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input=event.target as HTMLInputElement, file=input.files?.[0]; if(!file)return;
    await this.importFile(file,()=>input.value='');
  }
  onFileDragEnter(event:DragEvent):void{event.preventDefault();this.dragDepth++;this.isFileDragging=true;}
  onFileDragOver(event:DragEvent):void{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';this.isFileDragging=true;}
  onFileDragLeave(event:DragEvent):void{event.preventDefault();this.dragDepth=Math.max(0,this.dragDepth-1);this.isFileDragging=this.dragDepth>0;}
  async onFileDrop(event:DragEvent):Promise<void>{
    event.preventDefault();this.dragDepth=0;this.isFileDragging=false;
    const file=event.dataTransfer?.files[0];if(file)await this.importFile(file);
  }
  private async importFile(file:File,resetInput:()=>void=()=>undefined):Promise<void>{
    this.errorMessage=''; this.successMessage=''; this.checksum='';
    try {
      if(file.name.toLowerCase().endsWith('.zip')){
        if(file.size>4*1024*1024*1024)throw new Error('Das ZIP-Archiv ist größer als 4 GB.');
        const entries=await this.readZipRoms(file);
        if(!entries.length)throw new Error('Im ZIP-Archiv wurden keine unterstützten ROMs gefunden.');
        const saved:ArcadeGame[]=[], problems:string[]=[];
        for(const entry of entries){try{saved.push(await this.addRomToLibrary(entry));}catch(error){problems.push(entry.name+': '+(error instanceof Error?error.message:'ROM ungültig'));}}
        if(!saved.length)throw new Error('Keine ROM aus dem ZIP konnte gespeichert werden. '+problems.slice(0,2).join(' '));
        await this.refreshGames();
        if(saved.length===1){this.successMessage='ZIP-ROM geprüft und gespeichert.';await this.playGame(saved[0]);}
        else{this.isLibraryOpen=true;this.successMessage=`${saved.length} ROMs aus dem ZIP geprüft und gespeichert.${problems.length?` ${problems.length} Datei(en) übersprungen.`:''}`;}
        this.checksum=saved[0].checksum;
      }else{
        const game=await this.addRomToLibrary(file);
        this.checksum=game.checksum;this.successMessage='ROM geprüft und gespeichert.';
        await this.refreshGames();await this.playGame(game);
      }
    } catch(error) {this.errorMessage=error instanceof Error?error.message:'ROM konnte nicht gelesen oder lokal gespeichert werden.';}
    finally {resetInput();this.cd.markForCheck();}
  }

  private async addRomToLibrary(file:File):Promise<ArcadeGame>{
    const system=this.systemForExtension(file.name.split('.').pop()?.toLowerCase()??'');
    if(!system)throw new Error('Erlaubt sind .gb, .gbc, .gba, .nds, .3ds, .cci und .cxi.');
    const sizeLimit=system==='3ds'?4*1024*1024*1024:512*1024*1024;
    if(file.size>sizeLimit)throw new Error(system==='3ds'?'Die 3DS-Datei ist größer als 4 GB.':'Die ROM ist größer als 512 MB.');
    const bytes=new Uint8Array(await file.arrayBuffer()),problem=this.validateRom(bytes,system);
    if(problem)throw new Error(problem);
    const checksum=this.crc32(bytes).toString(16).toUpperCase().padStart(8,'0');
    const id=`${checksum}-${bytes.length}-${system}`,old=await this.storage.getGame(id);
    const romBuffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
    const storedRom=new Blob([romBuffer],{type:'application/octet-stream'});
    const game:ArcadeGame={id,name:old?.name??this.readRomTitle(bytes,system)??file.name,fileName:file.name,system,rom:storedRom,size:storedRom.size,checksum,
      addedAt:old?.addedAt??Date.now(),lastPlayedAt:Date.now(),playSeconds:old?.playSeconds??0};
    await this.storage.saveGame(game);return game;
  }

  private async readZipRoms(archive:File):Promise<File[]>{
    const bytes=new Uint8Array(await archive.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const min=Math.max(0,bytes.length-65557);let end=-1;
    for(let i=bytes.length-22;i>=min;i--){if(view.getUint32(i,true)===0x06054b50){end=i;break;}}
    if(end<0)throw new Error('Das ZIP-Archiv ist beschädigt oder nicht unterstützt.');
    const count=view.getUint16(end+10,true),centralSize=view.getUint32(end+12,true),centralOffset=view.getUint32(end+16,true);
    if(count===0xffff||centralSize===0xffffffff||centralOffset===0xffffffff)throw new Error('ZIP64-Archive werden derzeit nicht unterstützt.');
    if(count>5000||centralOffset+centralSize>bytes.length)throw new Error('Das ZIP-Archiv enthält zu viele Einträge oder ist beschädigt.');
    const decoder=new TextDecoder(),files:File[]=[];let cursor=centralOffset,totalExtracted=0;
    for(let i=0;i<count;i++){
      if(cursor+46>bytes.length||view.getUint32(cursor,true)!==0x02014b50)throw new Error('Das ZIP-Verzeichnis ist beschädigt.');
      const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),expectedCrc=view.getUint32(cursor+16,true);
      const compressed=view.getUint32(cursor+20,true),uncompressed=view.getUint32(cursor+24,true);
      const nameLength=view.getUint16(cursor+28,true),extraLength=view.getUint16(cursor+30,true),commentLength=view.getUint16(cursor+32,true),localOffset=view.getUint32(cursor+42,true);
      const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
      cursor+=46+nameLength+extraLength+commentLength;
      const system=this.systemForExtension(name.split('.').pop()?.toLowerCase()??'');
      if(!system||name.endsWith('/'))continue;
      if(flags&1)throw new Error(`„${name}“ ist verschlüsselt. Bitte entpacke es zuerst.`);
      if(method!==0&&method!==8)throw new Error(`„${name}“ verwendet eine nicht unterstützte ZIP-Komprimierung.`);
      if(uncompressed>4*1024*1024*1024||totalExtracted+uncompressed>4*1024*1024*1024)throw new Error('Die entpackten ROMs überschreiten 4 GB.');
      if(localOffset+30>bytes.length||view.getUint32(localOffset,true)!==0x04034b50)throw new Error(`Der ZIP-Eintrag „${name}“ ist beschädigt.`);
      const dataStart=localOffset+30+view.getUint16(localOffset+26,true)+view.getUint16(localOffset+28,true),dataEnd=dataStart+compressed;
      if(dataEnd>bytes.length)throw new Error(`Der ZIP-Eintrag „${name}“ ist abgeschnitten.`);
      let extracted:Uint8Array;
      if(method===0)extracted=bytes.slice(dataStart,dataEnd);
      else{
        if(typeof DecompressionStream==='undefined')throw new Error('Dieser Browser kann ZIP-Dateien nicht direkt entpacken.');
        const stream=new Blob([bytes.slice(dataStart,dataEnd)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        extracted=new Uint8Array(await new Response(stream).arrayBuffer());
      }
      if(extracted.length!==uncompressed||this.crc32(extracted)!==expectedCrc)throw new Error(`Prüfsumme der ZIP-Datei „${name}“ stimmt nicht.`);
      totalExtracted+=extracted.length;
      const romBuffer=extracted.buffer.slice(extracted.byteOffset,extracted.byteOffset+extracted.byteLength) as ArrayBuffer;
      files.push(new File([romBuffer],name,{type:'application/octet-stream'}));
    }
    return files;
  }

  async playGame(game: ArcadeGame, resumeSlot?: number): Promise<void> {
    if(this.playTimer)clearInterval(this.playTimer);
    this.showEjsToolbar=false;
    this.states=await this.storage.getStates(game.id);
    const latest=(resumeSlot ? this.states.find(s=>s.slot===resumeSlot) : undefined) ?? this.states[0] ?? null, oldRom=this.romUrl, oldState=this.stateUrl;
    this.romUrl=URL.createObjectURL(game.rom); this.stateUrl=latest?URL.createObjectURL(latest.data):null;
    this.activeGame={...game,lastPlayedAt:Date.now()}; this.selectedSystem=game.system;
    this.selectedName=game.name; this.checksum=game.checksum; this.isLibraryOpen=false;
    this.isStatesOpen=false; this.isPlaying=true; this.emulatorReady=false;
    await this.storage.saveGame(this.activeGame); await this.refreshGames();
    this.renderPlayer(this.romUrl, this.activeGame, this.stateUrl);
    if(oldRom)URL.revokeObjectURL(oldRom);if(oldState)URL.revokeObjectURL(oldState);
    this.playTimer=setInterval(()=>this.updatePlayTime(),15000);this.cd.markForCheck();
  }
  async resumeMostRecent():Promise<void>{const g=this.games.find(x=>x.lastPlayedAt>0);if(g)await this.playGame(g);else this.isLibraryOpen=true;}
  openLibrary():void{this.isLibraryOpen=true;setTimeout(()=>document.querySelector(".library-section")?.scrollIntoView({behavior:"smooth"}),0);}
  openArcade():void{this.isLibraryOpen=false;window.scrollTo({top:0,behavior:"smooth"});}
  async openGameStates(game:ArcadeGame):Promise<void>{if(this.isPlaying&&this.activeGame?.id!==game.id)this.closeGame();this.activeGame=game;this.selectedName=game.name;this.selectedSystem=game.system;this.checksum=game.checksum;await this.openStates();}
  async openStates():Promise<void>{this.isStatesOpen=true;await this.refreshStates();}
  async saveState(slot=this.selectedSlot):Promise<void>{
    if(!this.activeGame||!this.isPlaying)return;this.selectedSlot=slot;
    this.send({action:'set-slot',slot});this.send({action:'save-state',slot});
    this.settingsStatus='Speicherplatz '+slot+' wird gespeichert …';
  }
  async loadState(slot:number):Promise<void>{
    if(!this.activeGame)return;const state=(await this.storage.getStates(this.activeGame.id)).find(s=>s.slot===slot);
    if(!state){this.errorMessage='Speicherplatz '+slot+' ist leer.';return;}
    if(!this.isPlaying){await this.playGame(this.activeGame,slot);return;}
    this.send({action:'load-state',state:state.data});this.settingsStatus='Speicherplatz '+slot+' geladen.';
  }
  async exportState(slot:number):Promise<void>{
    if(!this.activeGame)return;const s=(await this.storage.getStates(this.activeGame.id)).find(x=>x.slot===slot);
    if(s)this.download(s.data,this.baseName(this.activeGame.name)+'-slot-'+slot+'.state');
  }
  async importStateFile(event:Event):Promise<void>{
    const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file||!this.activeGame)return;
    if(file.size>128*1024*1024){this.errorMessage='Save-State ist größer als 128 MB.';input.value='';return;}
    const item:ArcadeState={id:this.activeGame.id+':'+this.selectedSlot,gameId:this.activeGame.id,slot:this.selectedSlot,
      savedAt:Date.now(),data:new Blob([await file.arrayBuffer()],{type:'application/octet-stream'}),screenshot:''};
    await this.storage.saveState(item);await this.refreshStates();if(this.isPlaying)this.send({action:'load-state',state:item.data});
    this.successMessage='Save-State importiert.';input.value='';this.cd.markForCheck();
  }
  triggerStateImport(slot:number):void{this.selectedSlot=slot;this.stateImport?.nativeElement.click();}
  async deleteState(state:ArcadeState):Promise<void>{await this.storage.deleteState(state.id);await this.refreshStates();}
  async deleteGame(game:ArcadeGame):Promise<void>{
    if(!confirm('„'+game.name+'“ und alle dazugehörigen Speicherstände löschen?'))return;
    await this.storage.deleteGame(game.id);if(this.activeGame?.id===game.id)this.closeGame();await this.refreshGames();
  }
  async onCoverSelected(game:ArcadeGame,event:Event):Promise<void>{const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;if(!file.type.startsWith('image/')||file.size>3*1024*1024){this.errorMessage='Cover muss ein Bild unter 3 MB sein.';input.value='';return;}const reader=new FileReader();reader.onload=async()=>{const changed={...game,coverData:String(reader.result)};await this.storage.saveGame(changed);await this.refreshGames();};reader.readAsDataURL(file);input.value='';}
  startRename(game:ArcadeGame):void{this.renameId=game.id;this.renameDraft=game.name;}
  async renameGame(game:ArcadeGame):Promise<void>{
    const name=this.renameDraft.trim();if(!name)return;const changed={...game,name};await this.storage.saveGame(changed);
    if(this.activeGame?.id===game.id){this.activeGame=changed;this.selectedName=name;}this.renameId='';await this.refreshGames();
  }

  async setFilter(v:FilterMode):Promise<void>{this.filterMode=v;await this.storage.saveSetting('filter',v);this.applyDisplay();}
  async setDsLayout(v:DsLayout):Promise<void>{this.dsLayout=v;await this.storage.saveSetting('ds-layout',v);this.applyDisplay();}
  toggleTouchLayout():void{void this.setDsLayout(this.dsLayout==='touch'?'stacked':'touch');}
  async setAspect(v:string):Promise<void>{this.aspectRatio=v;await this.storage.saveSetting('aspect',v);this.applyDisplay();}
  toggleEjsToolbar():void{
    this.showEjsToolbar=!this.showEjsToolbar;
    this.playerFrame.nativeElement.contentDocument?.body.classList.toggle('show-ejs-toolbar',this.showEjsToolbar);
  }
  async setControls(v:ControlPreset):Promise<void>{this.controlPreset=v;await this.storage.saveSetting('controls',v);this.settingsStatus='Tastenbelegung gespeichert; gilt beim nächsten Spielstart.';}
  async setCustomKey(action:string,event:KeyboardEvent):Promise<void>{event.preventDefault();let key=event.key;if(key==='ArrowUp')key='up arrow';else if(key==='ArrowDown')key='down arrow';else if(key==='ArrowLeft')key='left arrow';else if(key==='ArrowRight')key='right arrow';else if(key===' ')key='space';else key=key.toLowerCase();if(key==='escape')return;this.customKeys={...this.customKeys,[action]:key};await this.storage.saveSetting('custom-keys',this.customKeys);this.settingsStatus='Taste für '+action.toUpperCase()+' gespeichert.';}
  async toggleFullscreen():Promise<void>{
    const frame=this.screenBezel.nativeElement;
    if(document.fullscreenElement)await document.exitFullscreen();else await frame.requestFullscreen();
  }
  async installApp():Promise<void>{
    const prompt=this.installPrompt as (Event&{prompt?:()=>Promise<void>})|null;
    if(prompt?.prompt){await prompt.prompt();this.installPrompt=null;this.installAvailable=false;}
    else this.settingsStatus='Im Browser-Menü „Installieren“ oder „Zum Startbildschirm“ wählen.';
  }
  closeGame():void{
    if(this.playTimer)clearInterval(this.playTimer);this.playTimer=null;
    this.playerFrame.nativeElement.srcdoc='<html><body style="background:#090a08"></body></html>';
    this.isPlaying=false;this.emulatorReady=false;this.activeGame=null;this.selectedName='';this.checksum='';this.revokeUrls();
  }


  private renderPlayer(romUrl:string,game:ArcadeGame,stateUrl:string|null):void{
    const safe=game.name.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
    const keys:ArcadeKeys=this.controlPreset==='custom'?this.customKeys:this.controlPreset==='wasd'?{up:'w',down:'s',left:'a',right:'d',a:'j',b:'k',start:'enter',select:'shift'}:{up:'up arrow',down:'down arrow',left:'left arrow',right:'right arrow',a:'x',b:'z',start:'enter',select:'shift'};
    const controls={0:{
      0:{value:keys.b,value2:'BUTTON_2'},1:{value:keys.a,value2:'BUTTON_4'},2:{value:keys.select,value2:'SELECT'},
      3:{value:keys.start,value2:'START'},4:{value:keys.up,value2:'DPAD_UP'},5:{value:keys.down,value2:'DPAD_DOWN'},
      6:{value:keys.left,value2:'DPAD_LEFT'},7:{value:keys.right,value2:'DPAD_RIGHT'},8:{value:keys.a,value2:'BUTTON_1'},9:{value:keys.b,value2:'BUTTON_3'}
    },1:{},2:{},3:{}};
    const resume=stateUrl?`window.EJS_loadStateURL='${stateUrl}';`:'';
    const dualScreen=game.system==='nds'||game.system==='3ds';
    const initialClass=`filter-${this.filterMode} ds-${dualScreen?this.dsLayout:'stacked'} system-${game.system} aspect-${this.aspectRatio.replace(':','-')}`;
    const options={'save-state-location':'browser','save-state-slot':1};
    const id=parseInt(game.checksum,16)||1;
    this.playerFrame.nativeElement.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      html,body,#game{margin:0;width:100%;height:100%;background:#090a08;overflow:hidden}body{display:grid;place-items:center}#game{position:relative;max-width:100%;max-height:100%;overflow:hidden}#game canvas{max-width:100%;max-height:100%;pointer-events:auto}body:not(.show-ejs-toolbar) #game .ejs_menu_bar{display:none!important}body.show-ejs-toolbar #game .ejs_menu_bar{display:flex!important}body.system-nds #game,body.system-3ds #game,body.system-nds #game canvas,body.system-3ds #game canvas{touch-action:none}body.ds-touch #game canvas{cursor:crosshair}body.system-nds #game:after,body.system-3ds #game:after{content:'';position:absolute;z-index:5;pointer-events:none;left:0;right:0;top:50%;height:6px;transform:translateY(-50%);background:linear-gradient(180deg,#050605,#171a15 45%,#050605);box-shadow:0 1px 3px #000c}
      body.filter-pixel #game canvas{image-rendering:pixelated}body.filter-soft #game canvas{filter:saturate(.88) contrast(.98)}body.filter-crt #game canvas{filter:saturate(1.12) contrast(1.08)}
      body.ds-top #game canvas,body.ds-touch #game canvas{height:100%;width:100%;max-height:100%;transform:none}body.ds-touch #game canvas{cursor:crosshair}body.ds-touch #game:before{content:'';position:absolute;z-index:4;pointer-events:none;left:2px;right:2px;top:50%;bottom:2px;border:2px solid #58c8ed;box-shadow:inset 0 0 0 1px #0c1219}
      /* Keep the bitmap flush with the canvas hit area. object-fit:contain can
         letterbox the drawn image inside the canvas while pointer coordinates
         are still measured against the full element, creating a stylus offset. */
      body.aspect-4-3 #game canvas,body.aspect-16-9 #game canvas{object-fit:fill}
    </style></head><body class="${initialClass}"><div id="game"></div><script>
      window.EJS_player='#game';window.EJS_core='${game.system}';window.EJS_gameUrl='${romUrl}';window.EJS_gameName='${safe.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}';
      window.EJS_disableMouseLock=${dualScreen};
      window.EJS_gameID=${id};window.EJS_pathtodata='https://cdn.emulatorjs.org/stable/data/';window.EJS_startOnLoaded=true;window.EJS_language='de-DE';
      window.EJS_defaultOptions=${JSON.stringify(options)};window.EJS_defaultControls=${JSON.stringify(controls)};window.EJS_fixedSaveInterval=10000;
      window.EJS_VirtualGamepadSettings=[{type:'dpad',location:'left',left:'14%',top:'50%',inputValues:[4,5,6,7]},{type:'button',text:'B',id:'b',location:'right',left:12,top:42,bold:true,input_value:8},{type:'button',text:'A',id:'a',location:'right',left:58,top:8,bold:true,input_value:0},{type:'button',text:'START',id:'start',location:'center',left:65,top:88,fontSize:12,block:true,input_value:3},{type:'button',text:'SELECT',id:'select',location:'center',left:5,top:88,fontSize:12,block:true,input_value:2}];
      window.EJS_Buttons={playPause:true,play:true,pause:true,restart:true,mute:true,unmute:true,settings:true,fullscreen:true,enterFullscreen:true,exitFullscreen:true,saveState:true,loadState:true,quickSave:true,quickLoad:true,saveSavFiles:true,loadSavFiles:true,screenRecord:true,gamepad:true,cheat:true,volume:true,screenshot:true,cacheManager:true,exitEmulation:true};
      ${resume}
      let paSlot=1;window.EJS_onGameStart=function(){parent.postMessage({source:'pocket-arcade',type:'game-ready'},location.origin)};
      window.EJS_onSaveState=function(p){let screenshot='';try{screenshot=document.querySelector('#game canvas')?.toDataURL('image/png')||''}catch{};parent.postMessage({source:'pocket-arcade',type:'native-save',slot:paSlot,state:p.state,screenshot},location.origin)};
      window.addEventListener('message',async function(e){if(e.source!==parent||e.data?.source!=='pocket-arcade')return;const d=e.data;
        try{const em=window.EJS_emulator;if(d.action==='set-slot'){paSlot=d.slot;return}
          if(d.action==='save-state'){const state=await em.gameManager.getState();let screenshot='';try{screenshot=document.querySelector('#game canvas')?.toDataURL('image/png')||''}catch{};parent.postMessage({source:'pocket-arcade',type:'state-saved',slot:d.slot,state,screenshot},location.origin)}
          if(d.action==='load-state'){const raw=await d.state.arrayBuffer();await em.gameManager.loadState(new Uint8Array(raw));parent.postMessage({source:'pocket-arcade',type:'state-loaded'},location.origin)}
        }catch(error){parent.postMessage({source:'pocket-arcade',type:'bridge-error',message:String(error)},location.origin)}
      });
    <\/script><script src="https://cdn.emulatorjs.org/stable/data/loader.js"><\/script></body></html>`;
  }

  private onEmulatorMessage(event:MessageEvent):void{
    if(event.source!==this.playerFrame.nativeElement.contentWindow||event.data?.source!=='pocket-arcade')return;
    const d=event.data;
    if(d.type==='game-ready'){this.emulatorReady=true;}
    if(d.type==='state-saved'||d.type==='native-save')void this.storeState(d.slot||this.selectedSlot,d.state,d.screenshot);
    if(d.type==='state-loaded')this.settingsStatus='Save-State geladen.';
    if(d.type==='bridge-error')this.errorMessage='Emulator-Aktion fehlgeschlagen: '+d.message;
    this.cd.markForCheck();
  }
  private async storeState(slot:number,raw:ArrayBuffer|Uint8Array,screenshot:string):Promise<void>{
    if(!this.activeGame)return;
    const bytes=raw instanceof ArrayBuffer?new Uint8Array(raw.slice(0)):new Uint8Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
    await this.storage.saveState({id:this.activeGame.id+':'+slot,gameId:this.activeGame.id,slot,savedAt:Date.now(),
      data:new Blob([bytes.buffer as ArrayBuffer],{type:'application/octet-stream'}),screenshot:screenshot||''});
    await this.refreshStates();this.settingsStatus='Speicherplatz '+slot+' gespeichert.';this.cd.markForCheck();
  }
  private send(message:Record<string,unknown>):void{
    if(!this.emulatorReady){this.errorMessage='Der Emulator startet noch. Bitte gleich noch einmal versuchen.';return;}
    this.playerFrame.nativeElement.contentWindow?.postMessage({source:'pocket-arcade',...message},location.origin);
  }
  private applyDisplay():void{
    if(!this.isPlaying||!this.activeGame)return;
    const dualScreen=this.activeGame.system==='nds'||this.activeGame.system==='3ds';
    const layout=dualScreen?this.dsLayout:'stacked';
    const body=this.playerFrame.nativeElement.contentDocument?.body;
    if(body)body.className=`filter-${this.filterMode} ds-${layout} system-${this.activeGame.system} aspect-${this.aspectRatio.replace(':','-')}`;
  }
  private async updatePlayTime():Promise<void>{
    if(!this.activeGame)return;
    this.activeGame={...this.activeGame,playSeconds:this.activeGame.playSeconds+15};
    await this.storage.saveGame(this.activeGame);await this.refreshGames();
  }
  private async refreshGames():Promise<void>{this.games=(await this.storage.getGames()).sort((a,b)=>b.lastPlayedAt-a.lastPlayedAt);this.cd.markForCheck();}
  private async refreshStates():Promise<void>{this.states=this.activeGame?await this.storage.getStates(this.activeGame.id):[];this.cd.markForCheck();}
  private revokeUrls():void{if(this.romUrl)URL.revokeObjectURL(this.romUrl);if(this.stateUrl)URL.revokeObjectURL(this.stateUrl);this.romUrl=null;this.stateUrl=null;}
  private readRomTitle(b:Uint8Array,s:ConsoleSystem):string|null{const start=s==='gb'?0x134:s==='gba'?0xa0:0;const length=s==='gb'?16:12;const title=Array.from(b.slice(start,start+length)).filter(x=>x>=0x20&&x<=0x7e).map(x=>String.fromCharCode(x)).join('').trim();return title.length>=2?title:null;}
  private systemForExtension(ext:string):ConsoleSystem|null{return ext==='gb'||ext==='gbc'?'gb':ext==='gba'?'gba':ext==='nds'?'nds':['3ds','cci','cxi'].includes(ext)?'3ds':null;}
  private validateRom(b:Uint8Array,s:ConsoleSystem):string|null{
    if(s==='gb'){
      if(b.length<0x150)return'Zu klein für einen Game-Boy-Header.';
      const logo=[0xce,0xed,0x66,0x66,0xcc,0x0d,0,0x0b,3,0x73,0,0x83,0,0x0c,0,0x0d,0,8,0x11,0x1f,0x88,0x89,0,0x0e,0xdc,0xcc,0x6e,0xe6,0xdd,0xdd,0xd9,0x99,0xbb,0xbb,0x67,0x63,0x6e,0x0e,0xec,0xcc,0xdd,0xdc,0x99,0x9f,0xbb,0xb9,0x33,0x3e];
      if(!logo.every((x,i)=>b[0x104+i]===x))return'Game-Boy-Logo im Header fehlt.';
      let sum=0;for(let i=0x134;i<=0x14c;i++)sum=(sum-b[i]-1)&255;
      return sum===b[0x14d]?null:'Game-Boy-Header-Prüfsumme stimmt nicht.';
    }
    if(s==='gba'){
      if(b.length<0xc0)return'Zu klein für einen GBA-Header.';
      if(b[0xb2]!==0x96)return'Fester GBA-Headerwert fehlt.';
      let sum=0;for(let i=0xa0;i<=0xbc;i++)sum+=b[i];
      return((-(sum+0x19))&255)===b[0xbd]?null:'GBA-Header-Prüfsumme stimmt nicht.';
    }
    if(s==='3ds'){
      if(b.length<0x200)return'Zu klein für einen 3DS-Header.';
      const magic=String.fromCharCode(...b.slice(0x100,0x104));
      if(magic!=='NCSD'&&magic!=='NCCH')return'3DS-Header fehlt (NCSD/NCCH). Unterstützt werden .3ds, .cci und .cxi.';
      return null;
    }
    if(b.length<0x200)return'Zu klein für einen DS-Header.';
    // DS homebrew, patches and some valid dumps alter header/logo bytes. Their
    // CRCs are useful diagnostics but should not prevent loading the ROM.
    if(!this.section(this.u32(b,0x20),this.u32(b,0x2c),b.length)||!this.section(this.u32(b,0x30),this.u32(b,0x3c),b.length))return'DS-Programmabschnitte sind ungültig oder abgeschnitten.';
    return null;
  }
  private section(o:number,n:number,len:number):boolean{return o>=0x200&&n>0&&o<=len&&n<=len-o;}
  private u16(b:Uint8Array,o:number):number{return b[o]|(b[o+1]<<8);}
  private u32(b:Uint8Array,o:number):number{return(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;}
  private crc16(b:Uint8Array,start:number,end:number):number{let crc=0xffff;for(let i=start;i<end;i++){crc^=b[i]<<8;for(let j=0;j<8;j++)crc=(crc&0x8000)?((crc<<1)^0x1021)&65535:(crc<<1)&65535;}return crc;}
  private crc32(b:Uint8Array):number{let crc=0xffffffff;for(const x of b){crc^=x;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
  private download(blob:Blob,name:string):void{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2500);}
  private baseName(name:string):string{return name.replace(/\.[^.]+$/,'').replace(/[^a-z0-9_-]/gi,'_');}
  gameSystem(system: ConsoleSystem): string { return this.systems.find(x => x.id === system)?.name ?? system; }
  formatSize(bytes: number): string { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB'; }
  formatDate(timestamp: number): string { return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp); }
  formatPlayTime(seconds: number): string { const mins = Math.floor(seconds / 60); return mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' min'; }
  stateForSlot(slot: number): ArcadeState | undefined { return this.states.find(state => state.slot === slot); }
}










