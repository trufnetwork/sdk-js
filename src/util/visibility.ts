
export type VisibilityEnum = number & { __brand: "VisibilityEnum" };

export const visibility = {
    public: 0 as VisibilityEnum,
    private: 1 as VisibilityEnum,
}

export const getVisibility = (input: VisibilityEnum): string => {
    return input === visibility.public ? "public" : "private";
}
