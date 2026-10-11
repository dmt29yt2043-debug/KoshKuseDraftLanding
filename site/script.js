(function(){
  var root=document.documentElement, native=root.classList.contains('is-native');
  var frame=document.getElementById('frame'), site=document.getElementById('site');
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  function $(id){return document.getElementById(id)}
  function clamp(v,a,b){return v<a?a:v>b?b:v}
  function lerp(a,b,t){return a+(b-a)*t}
  function easeOut(t){return 1-Math.pow(1-t,3)}
  function scrollTop(){return native?(window.scrollY||root.scrollTop):frame.scrollTop}
  function viewH(){return native?window.innerHeight:frame.clientHeight}
  function viewTop(){return native?0:frame.getBoundingClientRect().top}
  function scale(){if(native)return 1;var r=frame.getBoundingClientRect();return r.height/frame.offsetHeight||1}
  function relTop(el){return (el.getBoundingClientRect().top-viewTop())/scale()}
  function relBottom(el){return (el.getBoundingClientRect().bottom-viewTop())/scale()}
  var scroller=native?window:frame;
  var lockEl=native?document.body:frame;

  /* высота «экрана»: на телефоне её держит CSS (100svh), в стенде меряем рамку */
  function setAppH(){if(!native)site.style.setProperty('--app-h',frame.clientHeight+'px')}
  setAppH();window.addEventListener('resize',setAppH);

  /* плавная прокрутка — только после загрузки, чтобы ссылка с #якорем не «пролетала» всю страницу */
  window.addEventListener('load',function(){setTimeout(function(){root.classList.add('smooth')},60)});

  /* на телефоне модалку выносим из контейнера, чтобы fixed гарантированно считался от экрана */
  var qm=$('qmodal');
  if(native)document.body.appendChild(qm);

  /* =========================================================
     СЦЕНЫ ПРОКРУТКИ
     ========================================================= */

  /* --- манифест: разбиваем на слова; неразрывные пробелы держат предлог со словом --- */
  var inks=[].map.call(site.querySelectorAll('.ink'),function(p){
    var text=p.textContent,parts=text.split(' ');
    p.textContent='';
    var sr=document.createElement('span');sr.className='sr';sr.textContent=text;p.appendChild(sr);
    var vis=document.createElement('span');vis.setAttribute('aria-hidden','true');p.appendChild(vis);
    var words=parts.map(function(w,i){
      var s=document.createElement('span');s.className='w';s.textContent=w;vis.appendChild(s);
      if(i<parts.length-1)vis.appendChild(document.createTextNode(' '));
      return s;
    });
    if(reduce)words.forEach(function(w){w.classList.add('on')});
    return {el:p,words:words,n:reduce?words.length:0};
  });
  /* --- заголовки поднимаются из-под маски по словам; неразрывные пробелы держат пары слов вместе --- */
  site.querySelectorAll('.h-sec.rv,.h-display.rv,.clm-sub.rv').forEach(function(h){
    if([].some.call(h.children,function(c){return c.tagName!=='BR'}))return;   /* внутри допустим только перенос <br> */
    var nodes=[].slice.call(h.childNodes),wi=0;
    var text=nodes.map(function(n){return n.nodeType===1?' ':n.textContent}).join('').replace(/\s+/g,' ').trim();
    h.textContent='';h.classList.add('hs');
    var sr=document.createElement('span');sr.className='sr';sr.textContent=text;h.appendChild(sr);
    var vis=document.createElement('span');vis.setAttribute('aria-hidden','true');h.appendChild(vis);
    nodes.forEach(function(n){
      if(n.nodeType===1){vis.appendChild(document.createElement('br'));return}
      var parts=n.textContent.split(' ').filter(function(w){return w});
      parts.forEach(function(w,i){
        var m=document.createElement('span');m.className='wm';
        var x=document.createElement('span');x.className='wi';x.style.setProperty('--wi',wi++);x.textContent=w;
        m.appendChild(x);vis.appendChild(m);
        if(i<parts.length-1)vis.appendChild(document.createTextNode(' '));
      });
    });
  });
  function sceneInk(vh){
    if(reduce)return;
    inks.forEach(function(k){
      var t=relTop(k.el),h=k.el.offsetHeight;
      /* слово «зажигается», когда строка проходит от нижней трети экрана к его середине */
      var p=clamp((vh*.86-t)/(h+vh*.32),0,1);
      var n=Math.round(p*k.words.length);
      if(n===k.n)return;
      for(var i=Math.min(n,k.n);i<Math.max(n,k.n);i++)k.words[i].classList.toggle('on',i<n);
      k.n=n;
    });
  }

  /* --- герой: фото в арке; при загрузке арка раскрывается, при прокрутке — превращается в полный кадр --- */
  var heroMedia=$('hero-media'),heroImg=heroMedia.querySelector('img'),archOpen=reduce?1:0,archP=0;
  function drawArch(){
    if(reduce){heroMedia.style.clipPath='';heroImg.style.transform='';return}
    var w=heroMedia.offsetWidth,h=heroMedia.offsetHeight,o=easeOut(archOpen),p=archP;
    var side=lerp(lerp(.24,.085,o),0,p)*w;
    var topIn=lerp(lerp(.12,0,o),0,p)*h;
    var r=lerp((w-2*side)/2,26,p);
    heroMedia.style.clipPath='inset('+topIn.toFixed(1)+'px '+side.toFixed(1)+'px 0px '+side.toFixed(1)+'px round '+r.toFixed(1)+'px '+r.toFixed(1)+'px 26px 26px)';
    heroImg.style.transform='scale('+lerp(1.22,1.06,o)*lerp(1,1/1.06,p)+')';
  }
  function openArch(){
    if(reduce||archOpen>=1){archOpen=1;drawArch();return}
    var t0=null,D=1700;
    function step(t){if(!t0)t0=t;archOpen=clamp((t-t0)/D,0,1);drawArch();if(archOpen<1)requestAnimationFrame(step)}
    requestAnimationFrame(step);
  }
  function sceneHero(hh){
    var top=relTop(heroMedia),h=heroMedia.offsetHeight;
    var p=clamp((hh+10-top)/(h*.55),0,1);
    if(Math.abs(p-archP)>.001){archP=p;drawArch()}
  }
  drawArch();

  /* --- 1+1: две единицы сходятся, плюс проявляется --- */
  var o2o=$('one2one');
  function sceneOne(vh){
    var t=relTop(o2o),h=o2o.offsetHeight,c=t+h/2;
    var p=clamp((vh*.98-c)/(vh*.48),0,1);
    o2o.style.setProperty('--c',(1-easeOut(p)).toFixed(3));
  }

  /* --- продукты на телефоне: карточки ложатся стопкой, нижняя чуть уменьшается и бледнеет --- */
  var pcards=[].slice.call(site.querySelectorAll('.pcard'));
  var stacked=false;
  var pstack=$('pstack');
  function measureStack(){
    pstack.classList.remove('no-stack');
    var tall=pcards.some(function(c){return c.offsetHeight>viewH()-top.offsetHeight-40});
    if(tall)pstack.classList.add('no-stack');
    stacked=pcards.length&&getComputedStyle(pcards[0]).position==='sticky';
    if(!stacked)pcards.forEach(function(c){c.style.removeProperty('--s');c.style.removeProperty('--dim')});
  }
  function sceneStack(hh){
    if(!stacked||reduce)return;
    for(var i=0;i<pcards.length-1;i++){
      var cur=pcards[i],nxt=pcards[i+1];
      var dist=relTop(nxt)-(hh+14+i*14);
      var t=clamp(1-dist/cur.offsetHeight,0,1);
      cur.style.setProperty('--s',(1-.06*t).toFixed(4));
      cur.style.setProperty('--dim',(.5*t).toFixed(3));
    }
  }

  /* --- лёгкий параллакс фото в видео-карточке --- */
  var par=[].slice.call(site.querySelectorAll('[data-parallax]'));
  function sceneParallax(vh){
    if(reduce)return;
    par.forEach(function(img){var box=img.parentElement,t=relTop(box),h=box.offsetHeight;if(t>vh||t+h<0)return;var c=(t+h/2-vh/2);img.style.translate='0 '+(-c*parseFloat(img.dataset.parallax)).toFixed(1)+'px'});
  }

  /* --- здоровье: карточка-история. Фото листаются пальцем вбок (родная прокрутка со щелчком)
         и сами — при прокрутке страницы вниз; после свайпа страница доезжает до нужного места, так что обе стороны синхронны.
         На низком экране (телефон боком) — просто лента со свайпом --- */
  var hx=$('hx'),hxTrack=$('hx-track'),hxRail=$('hx-rail'),hxSlides=[].slice.call(hx.querySelectorAll('.hx-slide')),
      HXN=hxSlides.length,hxBtns=[],hxOn=false,hxI=-2,hxZone=420,hxLock=0,hxUser=false,hxProg=0,hxT=null,hxLoaded=false;
  hx.classList.add('live');
  hxSlides.forEach(function(sl,i){
    var b=document.createElement('button');b.type='button';
    b.setAttribute('aria-label','Пункт '+(i+1)+' из '+HXN+': '+sl.querySelector('h3').textContent);
    b.addEventListener('click',function(){hxGo(i)});
    hxRail.appendChild(b);hxBtns.push(b);
  });
  function hxW(){return hxTrack.clientWidth||1}
  function hxSet(i,move){
    if(i===hxI)return;hxI=i;
    hxSlides.forEach(function(sl,k){sl.classList.toggle('on',k===i)});
    hxBtns.forEach(function(b,k){b.classList.toggle('done',i>=0&&k<i);b.classList.toggle('on',k===i);b.setAttribute('aria-current',k===i?'true':'false')});
    if(move&&i>=0&&!hxUser){hxProg=Date.now()+800;hxTrack.scrollTo({left:i*hxW(),behavior:reduce?'auto':'smooth'})}
  }
  /* где должна стоять страница, чтобы в карточке был пункт i */
  function hxY(i){return scrollTop()+relTop(hx)-(top.offsetHeight+10)+i*hxZone}
  function hxGo(i){
    hxSet(i,true);
    if(!hxOn)return;
    hxLock=Date.now()+(reduce?60:900);
    scroller.scrollTo({top:Math.max(0,hxY(i)),behavior:reduce?'auto':'smooth'});
  }
  /* лента сдвинулась вбок не нами (палец, трекпад, клавиатура) — это свайп: ждём, пока успокоится, и подтягиваем страницу.
     Вертикальная прокрутка пальцем по карточке ленту вбок не двигает и сцене не мешает */
  hxTrack.addEventListener('scroll',function(){
    if(Date.now()>hxProg)hxUser=true;
    clearTimeout(hxT);
    hxT=setTimeout(function(){
      var j=Math.round(hxTrack.scrollLeft/hxW());
      if(hxUser){hxUser=false;if(j!==hxI)hxGo(j)}
      else if(!hxOn)hxSet(j,false);
    },140);
  },{passive:true});
  function measureHealth(){
    var on=viewH()>=560;
    hxZone=Math.round(viewH()*.6);
    hx.style.setProperty('--hx-zone',hxZone+'px');
    hx.style.setProperty('--hx-card',hx.querySelector('.hx-card').offsetHeight+'px');
    if(on!==hxOn){hxOn=on;hx.classList.toggle('on',on)}
    if(hxI>=0){hxProg=Date.now()+300;hxTrack.scrollTo({left:hxI*hxW(),behavior:'auto'})}
  }
  function sceneHealth(vh){
    var t=relTop(hx);
    /* фото сбоку браузер сам не грузит, пока лента не доедет — заранее, когда блок на подходе */
    if(!hxLoaded&&t<vh*2.5){hxLoaded=true;hxSlides.forEach(function(sl){var im=sl.querySelector('img');if(im)im.loading='eager'})}
    if(t>vh*.85||t+hx.offsetHeight<0){if(hxI!==-1&&!hxUser)hxSet(-1,false);return}   /* подписи проявляются, когда карточка входит в кадр */
    if(hxI===-1){hxI=-2}
    if(!hxOn){if(hxI<0)hxSet(Math.round(hxTrack.scrollLeft/hxW()),false);return}
    if(Date.now()<hxLock||hxUser)return;
    var p=((top.offsetHeight+10)-t)/hxZone;
    hxSet(Math.max(0,Math.min(HXN-1,Math.round(p))),true);
  }

  /* =========================================================
     ПРЕЛОАДЕР
     ========================================================= */
  /* рисунок и линию загрузки запускает маленький скрипт сразу после разметки заставки (KKintro),
     здесь — только финал: надпись перелетает в шапку, страница открывается */
  var intro=$('intro'),bWord=$('b-word'),K=window.KKintro;
  if(root.classList.contains('intro-on')&&K&&!K.done){
    var calm=root.classList.contains('intro-calm'),finished=false;
    lockEl.style.overflow='hidden';
    K.finish=function(){
      if(finished)return;finished=true;
      if(native)window.scrollTo(0,0);else frame.scrollTop=0;   /* под заставкой страница всегда в начале */
      intro.classList.add('out','skip');                /* буквы — сразу на месте, тапы проходят к странице */
      var word=intro.querySelector('.i-word');
      word.style.opacity='1';
      bWord.style.opacity='0';
      var a=word.getBoundingClientRect(),b=bWord.getBoundingClientRect();
      /* надпись перелетает на своё место в шапке (FLIP); в спокойной версии и когда шапки не видно (обзор стенда) — просто гаснет */
      if((calm||!(b.width>0))&&word.animate)word.animate([{opacity:1},{opacity:0}],{duration:calm?500:380,easing:'ease',fill:'forwards'});
      else if(word.animate){
        var s=b.width/a.width;
        word.animate([{transform:'translate(0,0) scale(1)'},{transform:'translate('+(b.left-a.left)+'px,'+(b.top-a.top)+'px) scale('+s+')'}],{duration:1050,easing:'cubic-bezier(.65,0,.35,1)',fill:'forwards'});
      }
      [intro.querySelector('.i-cat'),intro.querySelector('.i-bar'),intro.querySelector('.i-skip')].forEach(function(el){el&&el.animate&&el.animate([{opacity:1},{opacity:0}],{duration:380,easing:'ease',fill:'forwards'})});
      var bg=intro.querySelector('.i-bg');
      if(bg.animate)bg.animate([{opacity:1},{opacity:0}],{duration:800,delay:300,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});else bg.style.opacity='0';
      setTimeout(function(){root.classList.remove('intro-on');lockEl.style.overflow='';openArch()},380);
      if(calm)setTimeout(function(){bWord.style.opacity='';bWord.animate&&bWord.animate([{opacity:0},{opacity:1}],{duration:600,easing:'ease'})},420);
      setTimeout(function(){bWord.style.opacity='';intro.classList.remove('run');intro.style.display='none'},1080);
    };
  }else{
    root.classList.remove('intro-on');
    openArch();
  }

  /* =========================================================
     ИНТЕРФЕЙС
     ========================================================= */

  /* удержание фокуса в меню и анкете */
  function trap(box,e){
    if(e.key!=='Tab')return;
    var f=[].filter.call(box.querySelectorAll('a[href],button:not([disabled])'),function(x){return !x.hidden&&x.offsetParent!==null&&getComputedStyle(x).visibility!=='hidden'});
    if(!f.length)return;var a=f[0],z=f[f.length-1];
    if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}
    else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}
  }

  /* меню */
  var burger=$('burger'),menu=$('menu'),top=$('top');
  function setMenu(o,back){
    menu.classList.toggle('open',o);top.classList.toggle('menu-open',o);
    burger.setAttribute('aria-expanded',o);burger.setAttribute('aria-label',o?'Закрыть меню':'Меню');
    lockEl.style.overflow=(o||root.classList.contains('intro-on'))?'hidden':'';
    if(o){setAppH();var a=menu.querySelector('a');a&&setTimeout(function(){a.focus({preventScroll:true})},60)}
    else if(back)burger.focus({preventScroll:true});
  }
  burger.addEventListener('click',function(){setMenu(!menu.classList.contains('open'))});
  /* ссылки на разделы: плавная прокрутка без «#раздел» в адресе — иначе после перезагрузки сайт открывается не с начала */
  document.addEventListener('click',function(e){
    if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    var a=e.target.closest&&e.target.closest('a[href^="#"]');if(!a)return;
    var id=a.getAttribute('href').slice(1),t=id&&document.getElementById(id);
    if(!id){e.preventDefault();return}                 /* ссылки-заглушки «#» в подвале — без прыжка наверх и «#» в адресе */
    if(!t)return;
    e.preventDefault();
    if(menu.classList.contains('open'))setMenu(false);
    scroller.scrollTo({top:Math.max(0,scrollTop()+relTop(t)-top.offsetHeight+1),behavior:reduce?'auto':'smooth'});
    t.setAttribute('tabindex','-1');t.focus({preventScroll:true});
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){if(qm.classList.contains('on'))closeQ();else if(menu.classList.contains('open'))setMenu(false,true)}
    if(qm.classList.contains('on'))trap(qm,e);else if(menu.classList.contains('open'))trap(top,e);
  });

  /* появление: картинку подгружаем заранее (за ~1200px), шторку открываем, когда она загрузилась */
  var ioRoot=native?null:frame;
  function revealEl(el){
    if(el.classList.contains('in'))return;
    var im=el.classList.contains('unveil')?el.querySelector(':scope>img'):null;
    if(!im||(im.complete&&im.naturalWidth)){el.classList.add('in');return}
    im.loading='eager';
    var go=function(){el.classList.add('in')};
    im.addEventListener('load',go,{once:true});im.addEventListener('error',go,{once:true});setTimeout(go,2000);
  }
  var io=null,pre=null;
  if('IntersectionObserver' in window){
    io=new IntersectionObserver(function(es){es.forEach(function(e){
      if(!e.isIntersecting)return;
      /* в горизонтальных лентах открываем весь ряд сразу — иначе карточки при свайпе проявляются с опозданием */
      var row=e.target.closest('.slider,.phones');
      var els=row?row.querySelectorAll('.rv,.unveil'):[e.target];
      [].forEach.call(els,function(x){revealEl(x);io.unobserve(x)});
    })},{root:ioRoot,rootMargin:'0px 0px -4% 0px',threshold:.12});
    pre=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){var im=e.target;if(im.loading==='lazy')im.loading='eager';pre.unobserve(im)}})},{root:ioRoot,rootMargin:'1200px 0px 1200px 0px'});
    site.querySelectorAll('img[loading="lazy"]').forEach(function(im){pre.observe(im)});
  }
  site.querySelectorAll('.rv,.unveil').forEach(function(el){io?io.observe(el):el.classList.add('in')});

  /* тост */
  var toast=$('toast'),tt;
  function say(msg){toast.textContent=msg;toast.classList.add('on');clearTimeout(tt);tt=setTimeout(function(){toast.classList.remove('on')},2800)}
  site.querySelectorAll('[data-toast]').forEach(function(b){b.addEventListener('click',function(){say(b.getAttribute('data-toast'))})});

  /* финал: кошка выглядывает из-за края, когда блок въехал в кадр; по нажатию прячется и выглядывает снова */
  var fin=$('finale'),peek=$('peek'),peekT=null;
  if('IntersectionObserver' in window){
    var fio=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){fin.classList.add('seen');fio.disconnect()}})},{root:native?null:frame,threshold:.35});
    fio.observe(fin);
  }else fin.classList.add('seen');
  peek.addEventListener('click',function(){
    if(reduce||peek.classList.contains('hide'))return;
    peek.classList.add('hide');clearTimeout(peekT);
    peekT=setTimeout(function(){peek.classList.remove('hide')},1700);
  });

  /* сквозной сценарий «как работает система»: шаг ↔ экран телефона */
  var flow=$('flow');
  if(flow){
    var fBtns=[].slice.call(flow.querySelectorAll('button')),FLOWMAP=fBtns.map(function(b){return +b.getAttribute('data-tab')||0});
    window.KKflowSet=function(k,user){
      fBtns.forEach(function(b,i){b.classList.toggle('on',i===k);b.setAttribute('aria-pressed',i===k?'true':'false')});
      var tab=FLOWMAP[k];
      if(phLive)phSet(tab,user);
      else{phones.classList.add('pick');phItems.forEach(function(it,i){it.classList.toggle('hl',i===tab)})}
    };
    fBtns.forEach(function(b,k){b.addEventListener('click',function(){KKflowSet(k,true)})});
    /* телефон листается сам или вкладкой — подсвечиваем первый шаг с этим экраном */
    window.KKflowFromTab=function(tab){var k=FLOWMAP.indexOf(tab);if(k>=0)fBtns.forEach(function(b,i){b.classList.toggle('on',i===k)})};
  }

  /* кнопки: мягкий круг от точки касания */
  if(!reduce)document.addEventListener('pointerdown',function(e){
    var b=e.target.closest&&e.target.closest('.btn');if(!b)return;
    var r=b.getBoundingClientRect(),k=r.width/b.offsetWidth||1,d=Math.max(b.offsetWidth,b.offsetHeight)*2.2;
    var c=document.createElement('span');c.className='rip';
    c.style.width=c.style.height=d+'px';
    c.style.left=((e.clientX-r.left)/k-d/2)+'px';c.style.top=((e.clientY-r.top)/k-d/2)+'px';
    b.appendChild(c);setTimeout(function(){c.remove()},850);
  },{passive:true});

  /* точки на фото рациона: по нажатию — подпись, открыта одна за раз */
  var hsDots=[].slice.call(site.querySelectorAll('.hs-dot'));
  var hsClose=function(keep){hsDots.forEach(function(d){if(d===keep)return;d.setAttribute('aria-expanded','false');$(d.getAttribute('aria-controls')).classList.remove('open')})};
  hsDots.forEach(function(d){d.addEventListener('click',function(e){
    e.stopPropagation();var open=d.getAttribute('aria-expanded')!=='true';hsClose(d);
    d.setAttribute('aria-expanded',open?'true':'false');$(d.getAttribute('aria-controls')).classList.toggle('open',open);
  })});
  document.addEventListener('click',function(e){if(!e.target.closest||!e.target.closest('.hspots'))hsClose()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')hsClose()});

  /* приложение: на узком экране — один «живой» телефон с вкладками; листается свайпом и сам, пока его не трогали */
  var phones=site.querySelector('.phones'),phTabs=$('ph-tabs'),phItems=[].slice.call(phones.querySelectorAll('.ph-item')),
      phBtns=[].slice.call(phTabs.querySelectorAll('button')),phI=0,phLive=false,phTimer=null,phTouched=false,PH=['Рацион','Медкарта','Устройства'];
  function phStop(){if(phTimer){clearInterval(phTimer);phTimer=null}}
  function phSet(i,user){
    if(user){phTouched=true;phStop()}
    phI=(i+phItems.length)%phItems.length;
    phItems.forEach(function(it,k){it.style.setProperty('--d',k<phI?-1:1);it.classList.toggle('on',k===phI)});
    phBtns.forEach(function(b,k){b.setAttribute('aria-pressed',k===phI?'true':'false')});
    phTabs.style.setProperty('--t',phI);
    if(window.KKflowFromTab)KKflowFromTab(phI);
  }
  function measurePhones(){
    var live=site.offsetWidth<900;
    if(live===phLive)return;
    phLive=live;phones.classList.toggle('live',live);phTabs.hidden=!live;
    if(live)phSet(phI);else{phItems.forEach(function(it){it.classList.remove('on')});phStop()}
  }
  function scenePhones(vh){
    if(!phLive||phTouched||reduce)return;
    var t=relTop(phones),h=phones.offsetHeight,vis=t<vh*.75&&t+h>vh*.25;
    if(vis&&!phTimer)phTimer=setInterval(function(){phSet(phI+1)},3800);
    else if(!vis)phStop();
  }
  phBtns.forEach(function(b,k){b.addEventListener('click',function(){phSet(k,true)})});
  phones.addEventListener('click',function(e){var sp=phLive&&e.target.closest('.s-nav span');if(sp){var k=PH.indexOf(sp.textContent.trim());if(k>=0)phSet(k,true)}});
  var phX=null,phY=0;
  phones.addEventListener('touchstart',function(e){phX=e.touches[0].clientX;phY=e.touches[0].clientY},{passive:true});
  phones.addEventListener('touchend',function(e){
    if(phX===null||!phLive)return;var t=e.changedTouches[0],dx=t.clientX-phX,dy=t.clientY-phY;phX=null;
    if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.3)phSet(phI+(dx<0?1:-1),true);
  },{passive:true});

  /* прогресс лент */
  site.querySelectorAll('.slider[data-prog]').forEach(function(s){
    var bar=$(s.getAttribute('data-prog'));if(!bar)return;var th=bar.querySelector('i');
    function upd(){var max=s.scrollWidth-s.clientWidth,vis=Math.min(1,s.clientWidth/s.scrollWidth);th.style.width=(vis*100)+'%';var p=max>0?s.scrollLeft/max:0;th.style.transform='translateX('+(p*(1/Math.max(vis,.01)-1)*100)+'%)'}
    s.addEventListener('scroll',upd,{passive:true});window.addEventListener('resize',upd);upd();
  });

  /* =========================================================
     ЗАЯВКА: короткая первичная анкета на одном экране, черновик в браузере, отправка на /api/apply (form: v3)
     ========================================================= */
  var qbox=$('qbox'),qform=$('qform'),qBody=$('qf-body'),qProg=$('qf-prog'),qNext=$('qf-next'),qNav=$('qf-nav'),qFail=$('qf-fail'),qStepEl=$('qf-step'),
      qPane=qform.querySelector('.qf-pane[data-step="1"]'),qDone=qform.querySelector('.qf-done'),sending=false,lastFocus=null,
      DRAFT='kk_q3_draft',SENT='kk_q3_sent';
  /* старый адрес (hstgr.cloud) у части провайдеров режется, но если сайт открыт там — шлём на основной */
  var API=/\.hstgr\.cloud$/.test(location.hostname)?'https://kosh-kuse.187-77-18-20.sslip.io/api/apply':'/api/apply';
  function val(n){
    var el=qform.elements[n];if(!el)return '';
    if(!el.tagName){var on=[].filter.call(el,function(e){return e.checked});return on.length?on[0].value:''}
    if(el.type==='checkbox')return el.checked;
    return el.value.trim();
  }
  function fieldOf(n){var el=qform.elements[n];el=el&&!el.tagName?el[0]:el;return el&&el.closest('.qf-field')}
  function isM(){return val('sex')==='m'}
  function cap(v){return v?v.charAt(0).toUpperCase()+v.slice(1):v}
  var REQ=['name','city','contact','cat_name','goal','consent'];
  function okField(n){
    if(n==='contact')return val('method')==='phone'?val('phone').replace(/\D/g,'').length>=10:/^[A-Za-z0-9_]{5,32}$/.test(val('telegram').replace(/^@/,'').replace(/^(https?:\/\/)?t(elegram)?\.me\//,''));
    if(n==='consent')return val('consent')===true;
    return !!val(n);
  }
  function sync(){
    qbox.setAttribute('data-sex',isM()?'m':'f');
    var tg=val('method')!=='phone';
    qform.querySelector('[data-m="telegram"]').hidden=!tg;qform.querySelector('[data-m="phone"]').hidden=tg;
    /* линия сверху — сколько обязательного уже заполнено */
    var done=REQ.filter(okField).length;qProg.style.transform='scaleX('+(0.08+0.92*done/REQ.length).toFixed(3)+')';
  }
  function save(){
    try{
      var d={};
      [].forEach.call(qform.elements,function(el){
        if(!el.name||el.name==='company'||el.name==='consent')return;
        if(el.type==='radio'){if(el.checked)d[el.name]=el.value}
        else if(el.type==='checkbox'){if(el.checked)d[el.name]=true}
        else d[el.name]=el.value;
      });
      localStorage.setItem(DRAFT,JSON.stringify(d));
    }catch(e){}
  }
  function restore(){
    var d=null;try{d=JSON.parse(localStorage.getItem(DRAFT)||'null')}catch(e){}
    if(!d)return false;
    [].forEach.call(qform.elements,function(el){
      if(!el.name||!(el.name in d))return;var v=d[el.name];
      if(el.type==='radio')el.checked=(v===el.value);
      else if(el.type==='checkbox')el.checked=v===true;
      else el.value=v;
    });
    return true;
  }
  function setErr(n,msg){
    var f=fieldOf(n);if(!f)return;var e=f.querySelector('.qf-err');
    f.classList.toggle('bad',!!msg);if(e)e.textContent=msg||'';
    var el=qform.elements[n];if(el&&el.tagName)el.setAttribute('aria-invalid',msg?'true':'false');
    if(msg&&!reduce){f.classList.remove('shake');void f.offsetWidth;f.classList.add('shake')}
  }
  function check(){
    var m=isM(),errs=[];
    function need(name,ok,msg){setErr(name,ok?'':msg);if(!ok)errs.push(name)}
    need('name',!!val('name'),'Как к вам обращаться');
    need('city',!!val('city'),'В каком вы городе');
    if(val('method')==='phone'){var dg=val('phone').replace(/\D/g,'');need('phone',dg.length>=10&&dg.length<=15,'Проверьте номер — в нём 10–15 цифр')}
    else{var t=val('telegram').replace(/^@/,'').replace(/^(https?:\/\/)?t(elegram)?\.me\//,'');need('telegram',/^[A-Za-z0-9_]{5,32}$/.test(t)||/^\+?[\d\s()-]{10,20}$/.test(t),'Имя в Telegram — латиница, цифры и _, от 5 символов')}
    need('cat_name',!!val('cat_name'),m?'Напишите, как его зовут':'Напишите, как её зовут');
    need('goal',!!val('goal'),'Выберите, что ближе всего');
    need('consent',val('consent')===true,'Без согласия мы не сможем с вами связаться');
    if(errs.length){
      var f=fieldOf(errs[0]),el=qform.elements[errs[0]];
      if(f)f.scrollIntoView({block:'center',behavior:reduce?'auto':'smooth'});
      if(el&&el.tagName&&el.type!=='checkbox')setTimeout(function(){el.focus({preventScroll:true})},reduce?0:250);
    }
    return !errs.length;
  }
  function showDone(info){
    qPane.hidden=true;qDone.hidden=false;qNav.hidden=true;qFail.hidden=true;
    qProg.style.transform='scaleX(1)';qStepEl.textContent='Заявка у нас';
    qbox.querySelectorAll('[data-user]').forEach(function(x){x.textContent=info.user||''});
    qbox.querySelectorAll('[data-cat]').forEach(function(x){x.textContent=info.cat||''});
    qbox.querySelector('[data-how]').textContent=info.how==='phone'?'позвоним или напишем вам':'напишем вам в Telegram';
    qBody.scrollTop=0;var h=qDone.querySelector('.qf-h');setTimeout(function(){h&&h.focus({preventScroll:true})},60);
  }
  function showForm(){
    qDone.hidden=true;qPane.hidden=false;qNav.hidden=false;qFail.hidden=true;
    qStepEl.textContent='Заявка · около минуты';qNext.textContent='Подать заявку';
    qBody.scrollTop=0;sync();
  }
  qform.addEventListener('change',function(e){if(e.target.name)setErr(e.target.name,'');sync();save()});
  qform.addEventListener('input',function(e){if(e.target.name){setErr(e.target.name,'');sync();save()}});
  qform.addEventListener('submit',function(e){e.preventDefault();if(sending||!check())return;send()});
  function send(){
    sending=true;qFail.hidden=true;qNext.disabled=true;qNext.textContent='Отправляем…';
    var q=new URLSearchParams(location.search),utm={};
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){if(q.get(k))utm[k]=q.get(k)});
    var method=val('method')==='phone'?'phone':'telegram';
    var body={
      form:'v3',
      cat:{sex:isM()?'m':'f',name:val('cat_name'),age:val('age')},
      goal:{main:val('goal'),note:val('goal_note')},
      contact:{name:val('name'),method:method,value:method==='phone'?val('phone'):val('telegram'),city:val('city')},
      consent:val('consent')===true,company:qform.elements.company.value,
      meta:{page:location.href.split('#')[0].slice(0,300),ref:document.referrer.slice(0,300),utm:utm,mode:native?'site':'stand'}
    };
    var ctl=window.AbortController?new AbortController():null,to=setTimeout(function(){ctl&&ctl.abort()},15000);
    fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctl?ctl.signal:undefined})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){if(!r.ok||!j.ok)throw j;return j})})
      .then(function(){
        clearTimeout(to);sending=false;qNext.disabled=false;
        var info={cat:cap(body.cat.name),user:cap(body.contact.name),how:method};
        try{localStorage.removeItem(DRAFT);localStorage.setItem(SENT,JSON.stringify(info))}catch(e){}
        qform.elements.consent.checked=false;
        showDone(info);
      })
      .catch(function(j){
        clearTimeout(to);sending=false;qNext.disabled=false;qNext.textContent='Подать заявку';
        qFail.textContent=(j&&j.error)||'Не получилось отправить. Проверьте интернет и попробуйте ещё раз — ответы сохранены.';
        qFail.hidden=false;
      });
  }
  /* окно поверх клавиатуры: на телефоне держим анкету в видимой части экрана */
  var vv=window.visualViewport;
  function fitQ(){if(!native||!vv||!qm.classList.contains('on'))return;qm.style.top=vv.offsetTop+'px';qm.style.height=vv.height+'px';qm.style.bottom='auto'}
  if(vv){vv.addEventListener('resize',fitQ);vv.addEventListener('scroll',fitQ)}
  qform.addEventListener('focusin',function(e){
    if(!e.target.classList.contains('qf-in'))return;
    setTimeout(function(){var f=e.target.closest('.qf-field');f&&f.scrollIntoView({block:'center',behavior:reduce?'auto':'smooth'})},320);
  });
  function openQ(){
    if(qm.classList.contains('on'))return;
    var ae=document.activeElement;lastFocus=(ae&&ae!==document.body)?ae:$('open-q');
    if(!native){qm.style.top=frame.scrollTop+'px';qm.style.height=frame.clientHeight+'px';qm.style.bottom='auto'}
    var sent=null;try{sent=JSON.parse(localStorage.getItem(SENT)||'null')}catch(e){}
    var hasDraft=restore();
    if(sent&&!hasDraft)showDone(sent);else{showForm();var h=qPane.querySelector('.qf-h');setTimeout(function(){h&&h.focus({preventScroll:true})},60)}
    qm.classList.add('on');qm.setAttribute('aria-hidden','false');lockEl.style.overflow='hidden';fitQ();
  }
  function closeQ(){
    if(!qm.classList.contains('on'))return;
    qm.classList.remove('on');qm.setAttribute('aria-hidden','true');lockEl.style.overflow='';
    if(native){qm.style.top='';qm.style.height='';qm.style.bottom=''}
    if(lastFocus)lastFocus.focus({preventScroll:true});
  }
  $('qf-again').addEventListener('click',function(){
    try{localStorage.removeItem(SENT);localStorage.removeItem(DRAFT)}catch(e){}
    qform.reset();qform.querySelectorAll('.qf-field').forEach(function(f){f.classList.remove('bad')});qform.querySelectorAll('.qf-err').forEach(function(e){e.textContent=''});
    showForm();
  });
  $('qf-close').addEventListener('click',closeQ);
  $('open-q').addEventListener('click',openQ);$('q-x').addEventListener('click',closeQ);
  qm.addEventListener('click',function(e){if(e.target===qm)closeQ()});
  /* «Подать заявку» везде открывает анкету сразу; без JS ссылки ведут к блоку заявки */
  document.querySelectorAll('a[href="#waitlist"].btn-primary').forEach(function(a){
    a.addEventListener('click',function(e){e.preventDefault();if(menu.classList.contains('open'))setMenu(false);openQ()});
  });

  /* =========================================================
     ОДИН ЦИКЛ ПРОКРУТКИ ДЛЯ ВСЕХ СЦЕН
     ========================================================= */
  var sticky=$('sticky'),heroCta=$('hero-cta'),wl=$('waitlist');
  var topProg=$('top-prog');
  var ticking=false;
  function onScroll(){
    ticking=false;
    var vh=viewH(),hh=top.offsetHeight,st=scrollTop();
    top.classList.toggle('scrolled',st>8);
    /* плашка: видна, когда кнопка героя за кадром, и прячется у блока заявки */
    var passed=relTop(heroCta)+heroCta.offsetHeight<hh;
    sticky.classList.toggle('show',passed&&!(relTop(wl)<vh-80));
    var max=(native?root.scrollHeight:frame.scrollHeight)-vh;
    topProg.style.transform='scaleX('+(max>0?clamp(st/max,0,1):0).toFixed(4)+')';
    sceneHero(hh);sceneInk(vh);sceneOne(vh);sceneStack(hh);sceneParallax(vh);sceneHealth(vh);scenePhones(vh);
  }
  function req(){if(!ticking){ticking=true;requestAnimationFrame(onScroll)}}
  measureStack();measureHealth();measurePhones();
  scroller.addEventListener('scroll',req,{passive:true});
  window.addEventListener('resize',function(){
    if(menu.classList.contains('open')&&getComputedStyle(burger).display==='none')setMenu(false);
    measureStack();measureHealth();measurePhones();drawArch();req();
  });
  onScroll();

  /* =========================================================
     СТЕНД
     ========================================================= */
  if(native)return;
  var labelsCb=$('labels');
  function applyLabels(){frame.classList.toggle('labels',labelsCb.checked);try{localStorage.setItem('kk_labels',labelsCb.checked?'1':'0')}catch(e){}}
  labelsCb.addEventListener('change',applyLabels);
  try{if(localStorage.getItem('kk_labels')==='1')labelsCb.checked=true}catch(e){}
  applyLabels();
  var seg=$('seg'),sizeEl=$('size');
  function fit(){
    var isD=frame.classList.contains('d');
    var W=isD?1282:408;
    var avail=window.innerWidth-40;
    /* телефон должен помещаться и по высоте окна, иначе нижняя плашка уходит под край */
    var sc=Math.min(1,avail/W,isD?1:(window.innerHeight-56-24-16)/798);
    frame.style.transform='translateZ(0) scale('+sc+')';
    var h=isD?(window.innerHeight-120)/sc:780;
    frame.style.height=h+'px';
    frame.style.marginBottom=(h*sc-h)+'px';
    frame.style.marginLeft=frame.style.marginRight=(W*(sc-1)/2)+'px';
    sizeEl.textContent=sc<1?Math.round(sc*100)+'%':'';
    setAppH();measureStack();measureHealth();measurePhones();drawArch();req();
  }
  var ov=$('overview'),stage=$('stage');
  var MS=0.6,DS=0.42;
  function buildOverview(){
    ov.innerHTML='';
    site.querySelectorAll('[data-block]').forEach(function(b){
      if(b.dataset.block==='sticky_cta')return;
      var lab=b.querySelector(':scope > .blk');var name=lab?lab.textContent:b.dataset.block;
      var row=document.createElement('div');row.className='ov-row';
      var nm=document.createElement('div');nm.className='ov-name';nm.innerHTML=name+'<small>'+(b.id?'#'+b.id:'')+'</small>';row.appendChild(nm);
      var shots=document.createElement('div');shots.className='ov-shots';
      [['m','Мобильная · 390',MS],['d','Десктоп · 1280',DS]].forEach(function(cfg){
        var shot=document.createElement('div');shot.className='ov-shot';
        var cap=document.createElement('div');cap.className='ov-cap';cap.textContent=cfg[1];
        var box=document.createElement('div');box.className='ov-box';
        var inner=document.createElement('div');inner.className='ov-in '+cfg[0];inner.style.transform='scale('+cfg[2]+')';
        var c=b.cloneNode(true);c.removeAttribute('id');c.querySelectorAll('[id]').forEach(function(x){x.removeAttribute('id')});
        c.querySelectorAll('img[loading]').forEach(function(i){i.removeAttribute('loading')});
        c.querySelectorAll('[data-parallax]').forEach(function(i){i.style.translate=''});
        c.querySelectorAll('.hero-media').forEach(function(m){m.style.clipPath=''});
        c.querySelectorAll('.hero-media img').forEach(function(i){i.style.transform=''});
        c.querySelectorAll('.pcard').forEach(function(p){p.style.removeProperty('--s');p.style.removeProperty('--dim')});
        /* «Здоровье» в обзоре — без закрепления, подписи видны */
        c.querySelectorAll('.hx').forEach(function(h){h.classList.remove('on','live');h.style.removeProperty('--hx-card');h.style.removeProperty('--hx-zone')});
        c.querySelectorAll('.finale').forEach(function(f){f.classList.add('seen')});
        if(b.dataset.block==='header'){var m=c.querySelector('.menu');if(m)m.remove();c.classList.remove('menu-open');c.querySelectorAll('.b-word').forEach(function(w){w.style.opacity=''})}
        inner.appendChild(c);box.appendChild(inner);shot.appendChild(cap);shot.appendChild(box);shots.appendChild(shot);
        function size(){var h=inner.offsetHeight,w=inner.offsetWidth;box.style.width=Math.round(w*cfg[2])+'px';box.style.height=Math.round(h*cfg[2])+'px'}
        requestAnimationFrame(size);c.querySelectorAll('img').forEach(function(i){i.addEventListener('load',size)});
      });
      row.appendChild(shots);ov.appendChild(row);
    });
  }
  seg.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){
    closeQ();setMenu(false);
    seg.querySelectorAll('button').forEach(function(x){x.classList.remove('on')});b.classList.add('on');
    var v=b.dataset.v;
    if(v==='o'){stage.style.display='none';buildOverview();ov.classList.add('on')}
    else{ov.classList.remove('on');stage.style.display='';frame.className='frame '+v+(labelsCb.checked?' labels':'');fit()}
    try{localStorage.setItem('kk_view',v)}catch(e){}
  })});
  try{var v0=localStorage.getItem('kk_view');if(v0==='d'||v0==='o'){seg.querySelector('[data-v='+v0+']').click()}}catch(e){}
  window.addEventListener('resize',fit);fit();
})();
