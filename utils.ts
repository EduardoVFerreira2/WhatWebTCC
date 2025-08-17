export const containsLink = (text: string) => {
  // Expressão regular que verifica se a string contém http ou https
  const urlRegex = /https?:\/\/[^\s]+/g;
  return urlRegex.test(text);
};
