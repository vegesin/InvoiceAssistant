'use strict';
function localDate(value=new Date()){const date=value instanceof Date?value:new Date(value);if(Number.isNaN(date.getTime()))return null;return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
function addDays(value,days){if(!validDate(value))throw new Error('日期无效');const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function inRange(received,settings){
  if(!received)return true;
  const date=localDate(received);
  return !!date&&date>=settings.mailReceivedFrom&&(!settings.mailReceivedTo||date<=settings.mailReceivedTo);
}
module.exports={localDate,validDate,addDays,inRange};
