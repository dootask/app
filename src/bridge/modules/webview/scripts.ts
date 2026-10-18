import type { WebViewOverrideValues } from './state';

/**
 * 只增删自己的样式，不覆盖网页已有样式；重载后由 injectedJavaScript / onLoadEnd 重放。
 * setScrollEnabled 对齐旧壳只锁外层滚动（原生 scrollEnabled，Android 另加 html/body overflow），不拦截 touchmove，否则弹层内部列表也滑不动。
 */
export function webViewPreferencesScript(values: Pick<WebViewOverrideValues, 'scrollEnabled' | 'disabledUserLongClickSelect'>, android: boolean) {
  return `(function(){
    var prefs=window.__dootaskWebViewPreferences;
    if(!prefs){
      prefs=window.__dootaskWebViewPreferences={scrollEnabled:true,disabledSelection:false};
      document.addEventListener('contextmenu',function(e){if(prefs.disabledSelection)e.preventDefault();},true);
      document.addEventListener('selectstart',function(e){
        var t=e.target&&e.target.nodeType===1?e.target:e.target&&e.target.parentElement;
        if(prefs.disabledSelection&&!(t&&t.closest&&t.closest('input,textarea,[contenteditable]')))e.preventDefault();
      },true);
    }
    prefs.scrollEnabled=${JSON.stringify(values.scrollEnabled)};
    prefs.disabledSelection=${JSON.stringify(android && values.disabledUserLongClickSelect)};
    function apply(){
      var id='__dootaskWebViewPreferencesStyle';
      var style=document.getElementById(id);
      if(!style){style=document.createElement('style');style.id=id;(document.head||document.documentElement).appendChild(style);}
      // 输入控件保留选区，否则键盘弹出后无法长按移动光标/选词
      style.textContent=(prefs.disabledSelection?'*{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;}input,textarea,[contenteditable],[contenteditable] *{-webkit-user-select:text!important;user-select:text!important;}':'')+
        // iOS 只靠原生 scrollEnabled（同 eeui）；overflow:hidden 会让 WebKit 弹键盘时无法上推露出输入框
        (!prefs.scrollEnabled&&${JSON.stringify(android)}?'html,body{overflow:hidden!important;overscroll-behavior:none!important;}':'');
    }
    if(document.documentElement)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});
  })();true;`;
}
