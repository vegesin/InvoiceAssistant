'use strict';
function cents(n){return n===null||n===undefined?null:Math.round(Number(n)*100);}
function normalized(s){return String(s||'').replace(/有限责任公司|有限公司|分公司|支付|服务|[\s·()（）]/g,'').toLowerCase();}
function recommendations(invoices,screenshots){
  const candidates=[];
  for(const invoice of invoices.filter(x=>!x.screenshot_id&&x.amount>0)){
    for(const shot of screenshots.filter(x=>x.purpose==='payment'&&!x.invoice_id&&x.payment_state!=='invalid'&&x.payment_state!=='refund')){
      if(cents(invoice.amount)!==cents(shot.amount))continue;
      let score=50;const reasons=['金额相同'];
      const a=normalized(invoice.seller),b=normalized(shot.merchant);
      if(a.length>=2&&b.length>=2&&(a.includes(b)||b.includes(a))){score+=30;reasons.push('商户一致');}
      if(invoice.issue_date&&shot.pay_date){
        const days=(Date.parse(invoice.issue_date)-Date.parse(shot.pay_date))/86400000;
        if(days===0){score+=20;reasons.push('同日');}
        else if(days>=-1&&days<=7){score+=10;reasons.push('日期接近');}
        else if(Math.abs(days)>90){score-=25;reasons.push('日期相隔较远');}
      }
      candidates.push({invoiceId:invoice.id,screenshotId:shot.id,score,reasons});
    }
  }
  for(const c of candidates){
    const rivals=candidates.filter(x=>x!==c&&(x.invoiceId===c.invoiceId||x.screenshotId===c.screenshotId));
    const margin=rivals.length?c.score-Math.max(...rivals.map(x=>x.score)):100;
    c.confident=c.score>=70&&margin>=15;
    c.label=c.confident?'建议关联':margin<=0?'同金额多笔，需看图确认':'请看图核对';
  }
  return candidates.sort((a,b)=>b.score-a.score);
}
module.exports={recommendations};
