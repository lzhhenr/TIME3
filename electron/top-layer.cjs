// Reassert z-order without activating windows or taking keyboard focus.
function createTopLayer({entries,getPinned,interval=700}){
 const rank={main:0,mini:1,toast:2,roller:2};
 function refresh(){
  const visible=[...entries.values()].filter(e=>!e.win.isDestroyed()&&e.win.isVisible()).sort((a,b)=>rank[a.role]-rank[b.role]);
  for(const {win,role} of visible){const enabled=role!=='main'||getPinned();if(!enabled){if(win.isAlwaysOnTop())win.setAlwaysOnTop(false);continue;}win.setAlwaysOnTop(true,'screen-saver');win.moveTop();}
 }
 const timer=setInterval(refresh,interval);timer.unref?.();
 return {refresh,dispose:()=>clearInterval(timer)};
}
module.exports={createTopLayer};
