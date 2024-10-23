export type VisibilityEnum = number & { __brand: "VisibilityEnum" };

export const visibility = {
  public: 0 as VisibilityEnum,
  private: 1 as VisibilityEnum,
};

export const toVisibilityEnum = (input: string | number): VisibilityEnum => {
  const value = +input;
  if (value !== 0 && value !== 1) {
    throw new Error("Invalid visibility value");
  }
  return value as VisibilityEnum;
};

export const getVisibility = (input: VisibilityEnum): string => {
  return input === visibility.public ? "public" : "private";
};
