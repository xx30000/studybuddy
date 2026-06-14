import React from 'react';

export const iconMap = {
  alarm: '/images/icons-transparent/alarm.png',
  announcement: '/images/icons-transparent/announcement.png',
  bag: '/images/icons-transparent/bag.png',
  bell: '/images/icons-transparent/bell.png',
  catBook: '/images/icons-transparent/cat-book.png',
  catFace: '/images/icons-transparent/cat-face.png',
  catParty: '/images/icons-transparent/cat-party.png',
  check: '/images/icons-transparent/check.png',
  coin: '/images/icons-transparent/coin.png',
  crown: '/images/icons-transparent/crown.png',
  cup: '/images/icons-transparent/cup.png',
  flag: '/images/icons-transparent/flag.png',
  friends: '/images/icons-transparent/friends.png',
  game: '/images/icons-transparent/game.png',
  gear: '/images/icons-transparent/gear.png',
  heart: '/images/icons-transparent/heart.png',
  hourglass: '/images/icons-transparent/hourglass.png',
  key: '/images/icons-transparent/key.png',
  mail: '/images/icons-transparent/mail.png',
  message: '/images/icons-transparent/message.png',
  moneyBag: '/images/icons-transparent/money-bag.png',
  pencil: '/images/icons-transparent/pencil.png',
  sprout: '/images/icons-transparent/sprout.png',
  star: '/images/icons-transparent/star.png',
  taskList: '/images/icons-transparent/task-list.png',
};

export const notificationIconMap = {
  task: iconMap.check,
  coin: iconMap.coin,
  card: iconMap.bag,
  draw: iconMap.star,
  approval: iconMap.heart,
  announcement: iconMap.announcement,
  todo: iconMap.taskList,
  system: iconMap.bell,
};

export const historyIconMap = {
  task: iconMap.check,
  coin: iconMap.coin,
  card: iconMap.bag,
  draw: iconMap.star,
  announcement: iconMap.announcement,
  group: iconMap.flag,
  system: iconMap.gear,
};

export function UiIcon({ name, src, className = 'ui-icon', alt = '' }) {
  const iconSrc = src || iconMap[name] || iconMap.star;
  return React.createElement('img', {
    src: iconSrc,
    className,
    alt,
    onError: (event) => {
      const currentSrc = event.currentTarget.getAttribute('src') || '';
      if (currentSrc.includes('/images/icons-transparent/')) {
        event.currentTarget.src = currentSrc.replace('/images/icons-transparent/', '/images/icons/');
      }
    },
  });
}
