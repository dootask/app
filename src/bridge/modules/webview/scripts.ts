import type { WebViewOverrideValues } from './state';

/** 只增删自己的样式，不覆盖网页已有样式；重载后由 injectedJavaScript / onLoadEnd 重放。 */
export function webViewPreferencesScript(values: Pick<WebViewOverrideValues, 'scrollEnabled' | 'disabledUserLongClickSelect'>, android: boolean) {
  return `(function(){
    var prefs=window.__dootaskWebViewPreferences;
    if(!prefs){
      prefs=window.__dootaskWebViewPreferences={scrollEnabled:true,disabledSelection:false};
      document.addEventListener('contextmenu',function(e){if(prefs.disabledSelection)e.preventDefault();},true);
      document.addEventListener('selectstart',function(e){if(prefs.disabledSelection)e.preventDefault();},true);
      document.addEventListener('touchmove',function(e){if(!prefs.scrollEnabled)e.preventDefault();},{passive:false,capture:true});
      document.addEventListener('wheel',function(e){if(!prefs.scrollEnabled)e.preventDefault();},{passive:false,capture:true});
    }
    prefs.scrollEnabled=${JSON.stringify(values.scrollEnabled)};
    prefs.disabledSelection=${JSON.stringify(android && values.disabledUserLongClickSelect)};
    function apply(){
      var id='__dootaskWebViewPreferencesStyle';
      var style=document.getElementById(id);
      if(!style){style=document.createElement('style');style.id=id;(document.head||document.documentElement).appendChild(style);}
      style.textContent=(prefs.disabledSelection?'*{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;}':'')+
        (!prefs.scrollEnabled?'html,body{overflow:hidden!important;overscroll-behavior:none!important;}':'');
    }
    if(document.documentElement)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});
  })();true;`;
}
