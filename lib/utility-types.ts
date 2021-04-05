// @see:https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html
// @see: https://stackoverflow.com/a/50375286/7186598
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

// Helps make intellisense better sometimes, particularly when dealing with an intersection
type Identity<T> = { [K in keyof T]: T[K] };

type Zip<T extends readonly any[], U extends readonly any[]> = {
  [K in keyof T]: [T[K], K extends keyof U ? U[K] : never];
};

type FromZipped<T extends readonly [PropertyKey, any]> = T extends [infer K, infer V]
  ? Record<K & PropertyKey, V>
  : never;

type ArrayCombine<K extends readonly string[], V extends readonly any[]> = Identity<
  UnionToIntersection<FromZipped<Zip<K, V>[number]>>
>;

export { ArrayCombine };
