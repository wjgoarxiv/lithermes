import React from 'react';
import {AbsoluteFill, Composition, Easing, Img, interpolate, registerRoot, staticFile, useCurrentFrame} from 'remotion';
import settings from '../../cover-settings.json';

const pixelRows = ['00011111111000','00110000001100','01101111000110','11001001000011','11001111000011','11000000000011','11011110111011','11010000100011','11011110111011','11000000000011','01111111111110','00111111111100'];

function Cover({dark=false,mobile=false}: {dark?:boolean;mobile?:boolean}) {
  const frame=useCurrentFrame();
  const theme=settings.themes[dark?'dark':'light'];
  const entrance=interpolate(frame,[0,12,46,250,299],[0,12,0,0,0],{easing:Easing.bezier(.25,.8,.25,1),extrapolateRight:'clamp'});
  const breath=Math.sin(frame/299*Math.PI*2);
  const inset=mobile?86:112;
  return <AbsoluteFill style={{background:theme.field,color:theme.ink,overflow:'hidden'}}>
    <Img id="background-far" src={staticFile('background.png')} style={{position:'absolute',inset:-24,width:'calc(100% + 48px)',height:'calc(100% + 48px)',objectFit:'cover',filter:`blur(${settings.blurPx+12}px)`,transform:`scale(${1.06+0.008*breath})`,zIndex:0}}/>
    <Img id="background-near" src={staticFile('background.png')} style={{position:'absolute',inset:-12,width:'calc(100% + 24px)',height:'calc(100% + 24px)',objectFit:'cover',objectPosition:'right center',clipPath:'polygon(38% 0,100% 0,100% 100%,32% 100%)',filter:`blur(${Math.max(2,settings.blurPx/2)}px)`,transform:`scale(${1.035+0.004*breath})`,opacity:.82,zIndex:1}}/>
    <AbsoluteFill style={{background:'radial-gradient(ellipse at 80% 30%, #bade9f66, transparent 65%)',opacity:.6,zIndex:2}}/>
    <AbsoluteFill id="rim-light" style={{background:'linear-gradient(118deg, transparent 61%, #bade9f66 67%, #f4f1e988 69%, transparent 75%)',mixBlendMode:'screen',opacity:.82,filter:'blur(8px)',pointerEvents:'none',zIndex:3}}/>
    <div id="foreground-plane" style={{position:'absolute',left:0,top:0,width:mobile?'100%':'64%',height:mobile?'53%':'100%',background:theme.field,borderRight:'1px solid #bade9f55',boxShadow:'18px 0 48px #111d2533',zIndex:4}}/>
    <svg style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:settings.grainOpacity,pointerEvents:'none',zIndex:5}}><filter id="grain"><feTurbulence baseFrequency=".65" numOctaves="2" seed={settings.grainSeed}/></filter><rect width="100%" height="100%" filter="url(#grain)"/></svg>
    <div style={{position:'absolute',left:inset,right:inset,top:inset,borderTop:`2px solid ${theme.ink}`,opacity:.5,zIndex:6}}/>
    <Img src={staticFile(`label-${theme.outlineSuffix}.svg`)} style={{position:'absolute',left:inset,top:inset+36,width:mobile?540:460,height:30,objectFit:'contain',objectPosition:'left center',zIndex:6}}/>
    <Img src={staticFile(`title-${theme.outlineSuffix}.svg`)} style={{position:'absolute',left:inset,top:mobile?230:265,width:mobile?880:730,height:mobile?175:150,objectFit:'contain',objectPosition:'left center',transform:`translateY(${entrance}px)`,zIndex:6}}/>
    <Img src={staticFile(`subtitle-${theme.outlineSuffix}.svg`)} style={{position:'absolute',left:inset,top:mobile?460:475,width:mobile?840:680,height:62,objectFit:'contain',objectPosition:'left center',zIndex:6}}/>
    <svg viewBox="0 0 448 384" style={{position:'absolute',width:mobile?580:410,height:mobile?500:360,right:mobile?245:104,top:mobile?755:240,transform:`translateY(${breath*7}px)`,filter:'drop-shadow(16px 22px 0 #111d2522)',zIndex:6}} shapeRendering="crispEdges">
      {pixelRows.flatMap((row,y)=>[...row].flatMap((cell,x)=>cell==='1'?[<rect key={`${x}-${y}`} x={x*32} y={y*32} width="32" height="32" fill={dark?'#f4f1e9':'#111d25'}/>]:[]))}
      <rect x="64" y="128" width="256" height="32" fill="#acdb88"/><rect x="384" y="0" width="32" height="32" fill="#acdb88"/>
    </svg>
    <div style={{position:'absolute',left:inset,right:inset,bottom:inset,borderTop:`2px solid ${theme.ink}`,opacity:.5,zIndex:6}}/>
  </AbsoluteFill>;
}
function Root() {
  return <>{[false,true].flatMap((mobile)=>[false,true].map((dark)=><Composition key={`${mobile}-${dark}`} id={`${mobile?'Mobile':'Wide'}${dark?'Dark':'Light'}`} component={Cover} width={mobile?1080:1600} height={mobile?1350:800} fps={settings.fps} durationInFrames={settings.frames} defaultProps={{dark,mobile}}/>))}</>;
}
registerRoot(Root);
