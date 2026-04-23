import { Dialute, SberRequest } from 'dialute';

// Интерфейс для хранения данных пользователя
interface UserData {
  dailyNorm: number;
  currentAmount: number;
  lastResetDate: string;
}

// Хранилище данных
const userStorage = new Map<string, UserData>();

function getUserData(userId: string): UserData {
  const today = new Date().toISOString().split('T')[0];
  
  if (!userStorage.has(userId)) {
    userStorage.set(userId, {
      dailyNorm: 2000,
      currentAmount: 0,
      lastResetDate: today
    });
  }
  
  const userData = userStorage.get(userId)!;
  
  if (userData.lastResetDate !== today) {
    userData.currentAmount = 0;
    userData.lastResetDate = today;
  }
  
  return userData;
}

function parseWaterAmount(message: string): number | null {
  const patterns = [
    { regex: /(\d+)\s*миллилитр/, extract: (m: RegExpMatchArray) => parseInt(m[1]) },
    { regex: /(\d+)\s*мл/, extract: (m: RegExpMatchArray) => parseInt(m[1]) },
    { regex: /(\d+[,.]?\d*)\s*литр/, extract: (m: RegExpMatchArray) => parseFloat(m[1].replace(',', '.')) * 1000 },
    { regex: /стакан/, extract: () => 250 },
    { regex: /кружк/, extract: () => 300 },
    { regex: /бутылк/, extract: () => 500 },
    { regex: /чашк/, extract: () => 200 }
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern.regex);
    if (match) {
      return pattern.extract(match);
    }
  }
  
  return null;
}

function getProgressPercent(current: number, norm: number): number {
  return Math.min(100, Math.round((current / norm) * 100));
}

function getProgressBar(percent: number): string {
  const filledCount = Math.floor(percent / 10);
  const emptyCount = 10 - filledCount;
  return '█'.repeat(filledCount) + '░'.repeat(emptyCount);
}

// Генератор — основной обработчик команд
function* waterTracker(r: SberRequest) {
  const userId = r.userId || 'default-user';
  let userData = getUserData(userId);
  
  const normInLiters = (userData.dailyNorm / 1000).toFixed(1);
  const percent = getProgressPercent(userData.currentAmount, userData.dailyNorm);
  const progressBar = getProgressBar(percent);
  
  yield {
    text: `💧 Привет! Я ваш персональный трекер воды.
    
Сегодня вы выпили ${userData.currentAmount} мл из ${userData.dailyNorm} мл (${normInLiters} л).
${progressBar} ${percent}%

Что хотите сделать?
• Добавить воду — скажите "Добавь 250 мл" или "Я выпил стакан"
• Узнать прогресс — спросите "Сколько я выпил?"
• Изменить норму — скажите "Установи норму 2 литра"`,
    tts: `Привет! Я ваш трекер воды. Сегодня вы выпили ${userData.currentAmount} из ${userData.dailyNorm} миллилитров, это ${percent} процентов от нормы. Скажите, сколько воды вы выпили, или спросите свой прогресс.`
  };
  
  while (true) {
    userData = getUserData(userId);
    const userMessage = r.msg || '';
    const lowerMessage = userMessage.toLowerCase();
    
    // Команда: сколько выпито
    if (lowerMessage.includes('сколько') || 
        lowerMessage.includes('прогресс') ||
        lowerMessage.includes('статус')) {
      
      const percentVal = getProgressPercent(userData.currentAmount, userData.dailyNorm);
      const progressBarVal = getProgressBar(percentVal);
      const remaining = userData.dailyNorm - userData.currentAmount;
      
      yield {
        text: `📊 Ваш прогресс за сегодня:
        
Выпито: ${userData.currentAmount} мл
Норма: ${userData.dailyNorm} мл
Осталось: ${remaining} мл

${progressBarVal} ${percentVal}%

Отличная работа! Продолжайте в том же духе.`,
        tts: `Ваш прогресс за сегодня. Выпито ${userData.currentAmount} миллилитров из ${userData.dailyNorm}. Осталось выпить ${remaining} миллилитров. Это ${percentVal} процентов от нормы. Отличная работа!`
      };
      continue;
    }
    
    // Команда: установить норму
    const normMatch = userMessage.match(/(\d+[,.]?\d*)\s*литр/);
    if (lowerMessage.includes('норм') && normMatch) {
      let newNorm = parseFloat(normMatch[1].replace(',', '.'));
      if (newNorm < 0.5) newNorm = 0.5;
      if (newNorm > 5) newNorm = 5;
      
      const newNormMl = Math.round(newNorm * 1000);
      userData.dailyNorm = newNormMl;
      userStorage.set(userId, userData);
      
      yield {
        text: `✅ Готово! Я установил дневную норму воды на ${newNorm.toFixed(1)} литра (${newNormMl} мл).
        
Теперь я буду следить, чтобы вы выпивали достаточно воды для хорошего самочувствия!`,
        tts: `Установил новую норму воды — ${newNorm.toFixed(1)} литра. Теперь я буду следить за вашим прогрессом!`
      };
      continue;
    }
    
    // Команда: добавить воду
    const waterAmount = parseWaterAmount(userMessage);
    if (waterAmount !== null && 
        (lowerMessage.includes('добав') || lowerMessage.includes('выпил') || lowerMessage.includes('попил'))) {
      
      const newTotal = userData.currentAmount + waterAmount;
      userData.currentAmount = newTotal;
      userStorage.set(userId, userData);
      
      const percentVal = getProgressPercent(newTotal, userData.dailyNorm);
      const progressBarVal = getProgressBar(percentVal);
      const remaining = Math.max(0, userData.dailyNorm - newTotal);
      const isGoalReached = newTotal >= userData.dailyNorm;
      
      if (isGoalReached) {
        yield {
          text: `🎉 УРА! ПОЗДРАВЛЯЮ! 🎉

Вы выполнили дневную норму воды — ${userData.dailyNorm} мл!

Это отличный результат для вашего здоровья. Так держать! 💪

${progressBarVal} 100%`,
          tts: `Поздравляю! Вы выполнили дневную норму воды! Это отличный результат для вашего здоровья. Так держать!`
        };
      } else {
        yield {
          text: `✅ Добавлено ${waterAmount} мл воды!
          
📊 Текущий прогресс: ${newTotal} мл / ${userData.dailyNorm} мл
${progressBarVal} ${percentVal}%

Осталось выпить: ${remaining} мл`,
          tts: `Добавлено ${waterAmount} миллилитров. Теперь вы выпили ${newTotal} из ${userData.dailyNorm} миллилитров, это ${percentVal} процентов. Осталось ${remaining} миллилитров.`
        };
      }
      continue;
    }
    
    // Команда: сброс
    if (lowerMessage.includes('сброс') || lowerMessage.includes('очисти')) {
      userData.currentAmount = 0;
      userStorage.set(userId, userData);
      
      yield {
        text: `🔄 Данные сброшены. Сегодня вы пока не выпили ни капли.
        
Не забудьте восполнить водный баланс! 💧`,
        tts: `Данные сброшены. Не забудьте выпить воду!`
      };
      continue;
    }
    
    // Команда: помощь
    if (lowerMessage.includes('помощ') || lowerMessage.includes('что уме') || lowerMessage.includes('команд')) {
      yield {
        text: `📖 **Справка по командам**

💧 **Добавить воду:**
• "Добавь 250 мл"
• "Я выпил стакан" (250 мл)
• "Выпил кружку" (300 мл)
• "Бутылка воды" (500 мл)

📊 **Узнать прогресс:**
• "Сколько я выпил?"
• "Мой прогресс"
• "Статус"

⚙️ **Настройки:**
• "Установи норму 2 литра"
• "Сбросить данные"

🗣️ **Прочее:**
• "Помощь" — эта справка

Говорите естественно, я вас пойму!`,
        tts: `Вот список команд. Чтобы добавить воду, скажите "добавь 250 миллилитров" или "я выпил стакан". Чтобы узнать прогресс, спросите "сколько я выпил". Чтобы изменить норму, скажите "установи норму 2 литра".`
      };
      continue;
    }
    
    // Если команда не распознана
    yield {
      text: `🤔 Я не совсем понял. Вы хотите добавить воду, узнать прогресс или изменить норму?

Попробуйте сказать:
• "Добавь 250 мл"
• "Сколько я выпил?"
• "Установи норму 2 литра"
• Или скажите "Помощь" для всех команд`,
      tts: `Извините, я не понял. Скажите "добавь воду", "сколько выпил" или "помощь".`
    };
  }
}

// СОЗДАЁМ ПРИЛОЖЕНИЕ
const app = Dialute.fromEntrypoint(waterTracker as any);

// ЗАПУСКАЕМ СЕРВЕР (БЕЗ АРГУМЕНТА)
app.start();

console.log(`🚰 Трекер воды запущен!`);
console.log('📝 Настройте вебхук в SmartMarket Studio для тестирования');
