// ══════════════════════════════════════════════════════════════════════════
// LEGACY PROFILE — the owner's pre-accounts built-in defaults (v4.4.x)
// ══════════════════════════════════════════════════════════════════════════
// Loaded ON DEMAND by the legacy import only (account.js), which writes these
// into the owner's own encrypted account: payee lines -> customLines, the
// Itunu category -> customCats, budgets/fixed bills -> appConfig/profile, the
// four bank accounts -> cashAccounts. New users never load this file.
// Delete it once the owner has imported (it is still in git history).
'use strict';
window.LEGACY_PROFILE={
  catLines:{
  'Utilities': ['Power'],
  'Fuel': ['Gas','Fuel - Old Ford','Fuel - Ford'],
  'Car maintenance': ['Ford maintenance','Old Ford maintenance','Vehicle papers renewal'],
  'Itunu': ['Itunu'],
  'Domestic': ['Car purchase','Car wash','Service charge','Laundry','Home repairs','Rent','Temu','Cleaner'],
  'Food': ['Lunch','Eat out'],
  'Groceries': ['Ozzy shopping','Super Saver','Globus','Spar','Ebeano','Blenco','Sinomart','Cash groceries','Other groceries'],
  'Kids': ["Fife's school fees","Fife's (Other)","Fife's Bday"],
  'Internet services': ['Netflix/Amazon','Internet +Airtime'],
  'Recreation': ['UK Visa','DSTV','Outing','Outing BDG'],
  'Personal care': ['Medications','Personal care'],
  'Gifts and donations': ['Mama','Mum','Pentho','Pego','Dunsin','Gbago Day','Jennifer','Gbago','Tadeyon','Senapon Whesu','Mausi Whesu','Cash gifts','Baba Sesi','Athingban','Segowe','Sejiro','Yemi','Tope','Francis','MBO',"Dad's Bday","JO's Bday","Kola's Wedding","Olamide's wedding",'Pirotress','Xmas Gifts','Xmas gift (Gatemen)','Others'],
  'Loans': ['Semasa','Gbewato','Morin','House of Mayrie','Mauton','Tobi Talia','Jennifer','Maugbe'],
  'Others': ['Cash Withdrawal','Others'],
  'Work Travel': ['Home-MMIA','MMIA - Home','Westgate','Westgate - RB','LC Waikiki','RB - The View','Java House','RB - Westgate (Jen)','RB - Pizza Garden (all)','Pizza Garden (All)','Mall to RB (FJ)','RB to Mercure (JO)','RB to Riverside (JO)','Radisson - Address (All)','Address -Radisson (All)','Riverside - Marriot (All)'],
  'Education': ['Tuition','School fees'],
},
  defBudgets:{Utilities:90000,Fuel:150000,Carmaintenance:50000,Itunu:0,Domestic:200000,Food:150000,Groceries:400000,Kids:200000,Internetservices:50000,Recreation:100000,Personalcare:50000,Giftsanddonations:200000,Loans:0,Others:50000,WorkTravel:0,Education:0},
  fixedObl:[{label:'Service Charge',amount:55000},{label:'Internet & Airtime',amount:30000},{label:'Power',amount:90000},{label:'Fuel',amount:150000}],
  cashAccounts:['GTB','Access','Renmoney','USD Cash'],
  usdAccounts:['USD Cash'],
  extraCats:['Itunu'],
  platforms:[
  {key:'Piggy',label:'Piggy',color:'#c8f542',currency:'NGN'},
  {key:'PiggySafelock',label:'Piggy Safelock',color:'#a8d430',currency:'NGN'},
  {key:'RenVault',label:'RenVault',color:'#4a8aee',currency:'NGN'},
  {key:'Risevest',label:'Risevest',color:'#f5c842',currency:'USD'},
  {key:'Trove',label:'Trove',color:'#ff9f5c',currency:'USD'},
  {key:'Bamboo',label:'Bamboo',color:'#ff5c9f',currency:'USD'},
  ],
};
