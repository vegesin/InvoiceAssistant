'use strict';
function normalize(text){return String(text||'').normalize('NFKC').replace(/[﹣−–]/g,'-').replace(/[￥¥]/g,'¥').replace(/\u0000/g,'');}
function number(text){const clean=String(text||'').replace(/[,，\s¥￥元]/g,'');return /^-?\d+(?:\.\d{1,2})?$/.test(clean)?Math.round(Number(clean)*100)/100:null;}
function dateIn(text){
  const m=String(text).match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if(!m)return null;
  const value=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  return !Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value?value:null;
}
function cleanName(value){const name=String(value||'').replace(/^(?:名\s*称|销售方|购买方|收款方|商户名称|商品说明|商品|Merchant|Paid to)\s*[:：]?\s*/i,'').replace(/(?:统一社会信用代码|纳税人识别号|税号|地址|电话|开户行|账号|填开日期).*/,'').trim().slice(0,100);return /单位.*数量.*金额|规格型号|项目名称.*单价|税率.*税额|购买方名称/.test(name)?'':name;}
function parseInvoice(text,layout=[],filename=''){
  const raw=normalize(text);const t=raw.replace(/[ \t]+/g,' ');const compact=t.replace(/[ \t]/g,'');const lines=t.split(/\r?\n/);
  let amount=null;
  const totalPatterns=[
    /(?:小写)[^0-9¥-]{0,16}¥?\s*(-?\s*\d[\d,]*(?:\.\d{1,2})?)/i,
    /(?:价税合计|应收金额|发票金额|AmountDue|GrandTotal|TotalAmount)[^0-9¥-]{0,25}¥?\s*(-?\s*\d[\d,]*(?:\.\d{1,2})?)/i,
    /(?:票价|实收金额|合计金额|票款|Fare)[^0-9¥-]{0,12}¥?\s*(-?\s*\d[\d,]*(?:\.\d{1,2})?)/i,
  ];
  for(const pattern of totalPatterns){const m=compact.match(pattern);if(m){amount=number(m[1]);if(amount!==null)break;}}
  if(/航空运输|航空行程|机票/.test(compact+' '+filename)){
    const direct=compact.match(/合计[:：]?[ \t]*(?:CNY|RMB|¥)?[ \t]*(-?\d[\d,]*\.\d{2})(?!\d)/i);
    if(direct)amount=number(direct[1]);
    else for(let index=0;index<lines.length;index++)if(/票价/.test(lines[index])&&/合计/.test(lines[index])){
      const values=[...lines.slice(index+1,index+4).join(' ').matchAll(/CNY\s*(-?\d[\d,]*\.\d{2})(?!\d)/gi)];
      if(values.length>=2){amount=number(values.at(-1)[1]);break;}
    }
  }
  const invoiceNo=compact.match(/(?:发票号码|票据号码|InvoiceNo\.?|InvoiceNumber)[:：#]?\s*([0-9]{8,30})/i)?.[1]||null;
  const invoiceCode=compact.match(/发票代码[:：]?\s*([0-9]{10,12})/)?.[1]||null;
  const issueDate=dateIn(compact.match(/(?:开票日期|开具日期|填开日期|出票日期|InvoiceDate)[^\n]{0,40}/i)?.[0]||'')||null;
  let seller=cleanName(t.match(/(?:销售方名称|销售方|填开单位|开票单位|Seller|Merchant)\s*[:：]\s*([^\n]+)/i)?.[1]||'');
  let buyer=cleanName(t.match(/(?:购买方名称|购买方|Buyer)\s*[:：]\s*([^\n]+)/i)?.[1]||'');
  if(!seller){
    const names=[];
    for(const page of layout){
      for(const row of page.lines||[]){
        const right=(row.items||[]).filter(item=>item.x>page.width*0.43).map(item=>item.text).join('').replace(/\s/g,'');
        const rightMatch=right.match(/名称[:：]?(.+?)(?:统一社会|纳税人|识别号|$)/);
        if(rightMatch&&cleanName(rightMatch[1]).length>2)names.push({right:true,name:cleanName(rightMatch[1])});
        const full=row.text.replace(/\s/g,'').match(/名称[:：]?(.+?)(?:统一社会|纳税人|识别号|销售方|$)/);
        if(full&&cleanName(full[1]).length>2)names.push({right:false,name:cleanName(full[1])});
      }
    }
    seller=names.find(item=>item.right)?.name||names.at(-1)?.name||'';
    buyer ||= names.find(item=>!item.right&&item.name!==seller)?.name||'';
  }
  if(!seller){
    const labelled=lines.map((line,index)=>{
      const m=line.match(/(?:销\s*售\s*方\s*名\s*称|名\s*称)\s*[:：]\s*(.+)/);
      return m?cleanName(m[1]):null;
    }).filter(Boolean);
    seller=labelled.at(-1)||'';
    buyer ||= labelled.length>1?labelled[0]:'';
  }
  if(seller&&seller===buyer)seller='';
  const containsInvoice=/电子发票|增值税|税务|发票号码|Invoice\s*(?:No|Number)/i.test(compact);
  const supporting=/用车.*行程单|行程明细|结账单|对账单|消费明细|结算单/.test(compact+' '+filename)&&!containsInvoice;
  let invoiceType='电子发票';
  const hints=compact+' '+filename;
  if(/用车|打车|出租|滴滴|T3|首汽/i.test(hints))invoiceType='用车发票';
  else if(/铁路|火车|高铁/.test(hints))invoiceType='铁路客票';
  else if(/航空|机票|航空运输/.test(hints))invoiceType='航空行程单';
  else if(/酒店|住宿|宾馆|房费/.test(hints))invoiceType='住宿发票';
  const kind=supporting?'supporting':amount!==null&&amount<0?'refund':'invoice';
  let identity=null;
  if(invoiceNo?.length>=16)identity='invoice:'+invoiceNo;
  else if(invoiceNo&&(invoiceCode||(seller&&issueDate)))identity='invoice:'+(invoiceCode||seller+':'+issueDate)+':'+invoiceNo;
  return {amount:amount!==null&&amount>=0?amount:null,invoice_no:invoiceNo,invoice_code:invoiceCode,issue_date:issueDate,
    seller:seller||null,buyer:buyer||null,invoice_type:invoiceType,document_kind:kind,identity_key:identity,raw_text:raw,
    notice:kind==='refund'?'红字或退款票据，请单独核对':supporting?'行程/对账附件，不计作另一张发票':null};
}
function parsePayment(text,ocrLines=[]){
  const raw=normalize(text);const lines=raw.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  let amount=null;let sourceLine=null;
  for(let index=0;index<lines.length;index++){
    if(/实付|付款金额|支付金额|交易金额|订单实付|Amount Paid/i.test(lines[index])){
      const window=lines.slice(index,index+3).join(' ');
      const m=window.match(/(?:实付(?:金额)?|付款金额|支付金额|交易金额|订单实付|Amount Paid)\s*[:：]?\s*[¥$]?\s*(-?\s*\d[\d,]*(?:\.\d{1,2})?)/i);
      if(m){amount=number(m[1]);sourceLine=lines[index];break;}
    }
  }
  if(amount===null){
    const candidates=[];
    for(let index=0;index<lines.length;index++){
      const line=lines[index];
      if(/余额|优惠|抵扣|积分|手续费|服务费|税额|订单号|交易单号|流水|退款金额|退款成功|交易关闭|待支付/.test(line))continue;
      const m=line.match(/^(?:CNY|RMB|人民币)?\s*[¥$]?\s*(-?\s*\d+(?:,\d{3})*(?:\.\d{2}))\s*(?:元)?$/i);
      if(!m)continue;
      const parsed=number(m[1]);if(parsed===null)continue;const value=Math.abs(parsed);
      const matchingLine=ocrLines.find(item=>normalize(item.text).replace(/\s/g,'')===line.replace(/\s/g,''));
      const box=matchingLine?.box;const height=box?Math.abs(box[2][1]-box[0][1]):0;
      candidates.push({value,index,height,line});
    }
    const unique=new Set(candidates.map(item=>item.value));
    if(unique.size===1&&candidates.length){amount=candidates[0].value;sourceLine=candidates[0].line;}
    else if(candidates.length){
      candidates.sort((a,b)=>b.height-a.height||a.index-b.index);
      if(candidates[0].height>candidates[1]?.height*1.3){amount=candidates[0].value;sourceLine=candidates[0].line;}
    }
  }
  let merchant=null;
  for(let index=0;index<lines.length;index++){
    const m=lines[index].match(/^(?:商户(?:全称|名称)?|收款方|收款商家|收款人|商品(?:说明)?|Merchant|Paid to)\s*[:：]?\s*(.*)$/i);
    if(m){const name=cleanName(m[1]||lines[index+1]);if(name&&!/^\d|支付方式|订单|交易|付款/.test(name)){merchant=name;break;}}
    const to=lines[index].match(/向(.{2,40})付款/);if(to){merchant=cleanName(to[1]);break;}
  }
  const payDate=dateIn(raw);
  const status=/支付失败|交易关闭|已取消|等待付款|待支付/.test(raw)?'invalid':/退款成功|已全额退款/.test(raw)?'refund':'ok';
  return {amount:amount===null?null:Math.abs(amount),pay_date:payDate,merchant,raw_text:raw,
    channel:/支付宝|alipay/i.test(raw)?'alipay':/微信|wechat/i.test(raw)?'wechat':'other',
    payment_state:status,amount_evidence:sourceLine,recognition_state:amount===null?'partial':'ok'};
}
function friendlyInvoice(record){
  const merchant=record.seller||({'用车发票':'用车','住宿发票':'住宿','铁路客票':'铁路'}[record.invoice_type])||record.invoice_type||'待识别发票';
  return [record.issue_date||record.mail_received_at?.slice(0,10)||'日期待识别',merchant,record.amount===null||record.amount===undefined?'金额待识别':'¥'+Number(record.amount).toFixed(2)].join(' · ');
}
module.exports={normalize,number,dateIn,parseInvoice,parsePayment,friendlyInvoice};
