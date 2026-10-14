declare module "*.jpg" {
  const src: string;
  export default src;
}

declare module "*.sql?raw" {
  const source: string;
  export default source;
}
