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
  await page.getByRole('button',{name:'Надіслати еПМК'}).click();await expect(page.getByRole('status')).toContainText(/Прийнято|Повтор/);
  await page.getByRole('button',{name:'Повторити ту саму подію'}).click();await expect(page.getByRole('status')).toContainText('Повтор: нових кейсів');
});
