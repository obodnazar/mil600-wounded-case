import {test,expect} from '@playwright/test';
const banner='Навчальний прототип KSE. Не офіційний сервіс Міноборони. Дані вигадані';
for(const screen of [{name:'desktop',width:1440,height:1050},{name:'mobile',width:390,height:844}]){
 for(const panel of [{label:'Мій кейс',title:'Мій кейс',file:'patient'},{label:'Супровід',title:'Супровід кейсів',file:'staff'},{label:'Аналітика',title:'Огляд процесу',file:'analytics'},{label:'Симулятор',title:'Симулятор джерел',file:'simulator'}]){
  test(`${screen.name}: ${panel.label} — адаптивність і знімок`,async({page})=>{
    await page.setViewportSize({width:screen.width,height:screen.height});await page.goto('/');
    await expect(page.getByRole('heading',{level:1})).toBeVisible();
    await page.getByRole('navigation').getByRole('button',{name:panel.label,exact:true}).click();await expect(page.getByRole('heading',{name:panel.title,exact:true})).toBeVisible();
    await expect(page.getByText(banner,{exact:true})).toBeVisible();
    const sizes=await page.locator('body').evaluate(el=>({scroll:el.scrollWidth,width:window.innerWidth}));expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
    if(process.env.UPDATE_SCREENSHOTS==='true')await page.screenshot({path:`screenshots/${panel.file}-${screen.name}.png`,fullPage:screen.name==='desktop'});
  });
 }
}

test('чотири панелі, серверні межі й стійкий повтор у браузері',async({page})=>{
  await page.goto('/');await expect(page.getByRole('heading',{level:1})).toContainText('Від події');
  await page.getByRole('navigation').getByRole('button',{name:'Мій кейс'}).click();await expect(page.getByRole('heading',{name:'Мій кейс',exact:true})).toBeVisible();
  await expect(page.getByText('Дату отримання підтвердити',{exact:true})).toBeVisible();await expect(page.getByText(banner,{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Що буде далі'}).click();await expect(page.getByRole('heading',{name:'Ви бачите крок. Супровід веде справу.'})).toBeVisible();
  await page.getByRole('navigation').getByRole('button',{name:'Супровід'}).click();await expect(page.getByRole('heading',{name:'Супровід кейсів'})).toBeVisible();
  await page.getByRole('button',{name:'Командир',exact:true}).click();await expect(page.getByRole('button',{name:'Командир',exact:true})).toHaveAttribute('aria-pressed','true');
  const forbidden=await page.request.get('/api/cases/demo-case-01/clinical-document');expect(forbidden.status()).toBe(403);
  const foreign=await page.request.get('/api/cases/demo-case-11');expect(foreign.status()).toBe(404);
  await page.getByRole('navigation').getByRole('button',{name:'Аналітика'}).click();await expect(page.getByRole('heading',{name:'Огляд процесу'})).toBeVisible();
  await expect(page.locator('.metric')).toHaveCount(6);await expect(page.getByText('Малі групи й пов’язані підсумки не розкриваємо')).toBeVisible();
  const body=await (await page.request.get('/api/analytics')).json() as Record<string,unknown>;expect(body.total).toBeUndefined();expect(JSON.stringify(body)).not.toContain('demo-person-');
  await page.getByRole('navigation').getByRole('button',{name:'Симулятор'}).click();await expect(page.getByRole('heading',{name:'Симулятор джерел'})).toBeVisible();
  await page.getByRole('button',{name:'Надіслати еПМК'}).click();await expect(page.locator('.result')).toContainText(/Прийнято|Повтор/);
  await page.getByRole('button',{name:'Повторити ту саму подію'}).click();await expect(page.locator('.result')).toContainText('Повтор: нових кейсів');
});

test('8б D1 у браузері: команди ролей, джерела, два види виплат і малий агрегат',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();
 const panel=async(name:string)=>{await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();await expect(page.getByRole('button',{name:'Оновити',exact:true})).toBeEnabled();};
 const send=async(id:string)=>{await page.getByLabel('Навчальна подія').selectOption(id);await page.getByRole('button',{name:/^Надіслати/}).click();await expect(page.locator('.result')).toContainText(/Прийнято|Повтор:/);await expect(page.getByRole('button',{name:'Оновити',exact:true})).toBeEnabled();};
 await panel('Симулятор');for(const id of ['primary','admit','care-start','transfer','patient-receipt','certificate-prepared'])await send(id);
 await panel('Супровід');await expect(page.getByRole('button',{name:'Направити на ВЛК',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Командир',exact:true}).click();await page.getByRole('button',{name:'Запит видачі довідки',exact:true}).click();await expect(page.locator('.global-result')).toContainText('Запит збережено');
 await panel('Симулятор');for(const id of ['certificate-issued','certificate-sent','certificate-received','reward-packet','reward-approved','reward-execution_partial','reward-execution_confirmed'])await send(id);
 await panel('Мій кейс');await expect(page.getByText('Виконання підтверджене джерелом',{exact:true})).toBeVisible();await expect(page.getByText('Адміністративну дію виконано',{exact:true})).toHaveCount(0);
 await panel('Супровід');await page.getByRole('button',{name:'Командир',exact:true}).click();await page.getByRole('button',{name:'Направити на ВЛК',exact:true}).click();await expect(page.locator('.global-result')).toContainText('Запит збережено');
 await panel('Симулятор');for(const id of ['referral','vlk-received','vlk-decision','service-executed','ogd-packet','ogd-returned','ogd-approved-after-returned','ogd-execution_partial','ogd-execution_confirmed','ogd-oct-packet','ogd-oct-approved'])await send(id);
 await panel('Мій кейс');await expect(page.getByText('Адміністративну дію виконано',{exact:true})).toHaveCount(1);await expect(page.getByText('Виконання підтверджене джерелом',{exact:true})).toHaveCount(2);await expect(page.getByText('Схвалено; виконання ще не підтверджене',{exact:true})).toHaveCount(1);
 if(process.env.UPDATE_SCREENSHOTS==='true')await page.screenshot({path:'screenshots/d1-patient-desktop.png',fullPage:true});
 await panel('Симулятор');await page.getByRole('button',{name:'Мала група · перевірити приховування',exact:true}).click();await expect(page.locator('.result')).toContainText('зріз обрано');await panel('Аналітика');await expect(page.locator('.metric-value').filter({hasText:'Приховано'})).toHaveCount(5);if(process.env.UPDATE_SCREENSHOTS==='true')await page.screenshot({path:'screenshots/suppressed-analytics-desktop.png',fullPage:true});
 await panel('Симулятор');await page.getByRole('button',{name:'Основний вигаданий зріз',exact:true}).click();await expect(page.locator('.result')).toContainText('зріз обрано');
});

test('8б збій мережі не показує успіх; повтор команди з тим самим ключем; роль очищає старий view',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();await page.getByRole('navigation').getByRole('button',{name:'Мій кейс',exact:true}).click();await expect(page.getByRole('heading',{name:'Мій кейс',exact:true})).toBeVisible();
 const ids:string[]=[];let lose=true;
 await page.route('**/api/commands',async route=>{ids.push((route.request().postDataJSON() as {id:string}).id);if(lose){lose=false;await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.getByRole('button',{name:'Попросити уточнення',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Мережевий збій');await expect(page.locator('.global-result')).toHaveCount(0);await expect(page.getByRole('heading',{name:'Мій кейс',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Попросити уточнення',exact:true}).click();await expect(page.locator('.global-result')).toContainText('Запит збережено');expect(ids).toHaveLength(2);expect(ids[0]).toBe(ids[1]);
 await page.route('**/api/staff',r=>r.abort('failed'));await page.getByRole('navigation').getByRole('button',{name:'Супровід',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('heading',{name:'Мій кейс',exact:true})).toHaveCount(0);await expect(page.locator('.timeline')).toHaveCount(0);
});

test('8б підтверджений POST і збій оновлення: успішний запис не оголошується втраченим',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();await page.getByRole('navigation').getByRole('button',{name:'Мій кейс',exact:true}).click();await expect(page.getByRole('heading',{name:'Мій кейс',exact:true})).toBeVisible();
 await page.route('**/api/patient',r=>r.abort('failed'));await page.getByRole('button',{name:'Попросити уточнення',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Дію підтверджено сервером, але панель не оновлено');await expect(page.locator('.global-result')).toContainText('Запит збережено');await expect(page.getByRole('heading',{name:'Мій кейс',exact:true})).toBeVisible();
});
