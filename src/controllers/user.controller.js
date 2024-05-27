import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import {
  uploadOnCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/Apiresponse.js";
import jwt from "jsonwebtoken";
import fs from "fs";

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforesave: false });
    return { accessToken, refreshToken };
  } catch (error) {
    throw new Error(500, "Something went wrong while generating tokens");
  }
};

const registerUser = asyncHandler(async (req, res) => {
  //get user details from frontend
  //validation - not empty
  //check if user already exists:username,email
  //check for images,check for avatar
  //upload them to cloudinary,avatar
  //create user object - create entry in db
  //remove pasword and refresh token field from response
  //check for user creation
  //return response

  const { fullName, email, username, password } = req.body;
  console.log("email: ", email);
  if (
    [fullName, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required");
  }
  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });
  if (existedUser) {
    throw new ApiError(409, "User with email or username already exists");
  }
  // console.log(req.files)
  const avatarLocalPath = req.files?.avatar[0]?.path;
  // const coverImageLocalPath = req.files?.coverImage[0]?.path;
  let coverImageLocalPath;
  if (
    req.files &&
    Array.isArray(req.files.coverImage) &&
    req.files.coverImage.length > 0
  ) {
    coverImageLocalPath = req.files.coverImage[0].path;
  }
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is required");
  }
  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!avatar) {
    throw new ApiError(400, "Avatar file is required");
  }
  const user = await User.create({
    fullName,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    username: username.toLowerCase(),
    password,
  });
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );
  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user");
  }
  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User registered successfully"));
});

const loginUser = asyncHandler(async (req, res) => {
  //req body ->data
  //username or email
  //find the user
  //password check
  //access token and refresh token
  //send cookies

  const { email, username, password } = req.body;

  if (!(username || email)) {
    throw new ApiError(400, "username or email is required");
  }
  const user = await User.findOne({
    $or: [{ username }, { email }],
  });
  if (!user) {
    throw new ApiError(404, "User does not exits");
  }
  const isPasswordValid = await user.isPasswordCorrect(password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid password");
  }
  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  const options = {
    httpOnly: true,
    secure: true,
  };
  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser.accessToken,
          refreshToken,
        },
        "User logged in successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  if (!req.user) {
    throw new ApiError(401, "Unauthorized request");
  }
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $unset: {
        refreshToken: 1,
      },
    },
    {
      new: true,
    }
  );
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
  };
  // return res
  // .status(200)
  res.clearCookie("accessToken", options);
  res.clearCookie("refreshToken", options);
  return res
    .status(200)
    .json(new ApiResponse(200, {}, "User logged Out successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;
  if (!incomingRefreshToken) {
    throw new ApiError(401, "unauthorized request");
  }
  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );
    const user = await User.findById(decodedToken?._id);
    if (!user) {
      throw new ApiError(401, "Invalid Refresh Token");
    }
    if (incomingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, "Refresh token is expired or used");
    }
    const options = {
      httpOnly: true,
      secure: true,
    };
    const { accessToken, newRefreshToken } =
      await generateAccessAndRefreshTokens(user._id);
    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, refreshToken: newRefreshToken },
          "Access Token refreshed"
        )
      );
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token");
  }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword, confirmPassword } = req.body;
  if (!(newPassword === confirmPassword)) {
    throw new ApiError(400, "New password and confirm password do not match");
  }

  const user = await User.findById(req.user?._id);
  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);
  if (!isPasswordCorrect) {
    throw new ApiError(400, "Invalid password");
  }
  user.password = newPassword;
  await user.save({ validateBeforesave: false });
  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"));
});


const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(200, req.user, "Current user fetched successfully");
});


const updateAccountDetails = asyncHandler(async (req, res) => {
  const { fullName, email } = req.body;
  if (!fullName || !email) {
    throw new ApiError(400, "All fields are required");
  }
  const user = User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullName,
        email,
      },
    },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"));
});


const updateUserAvatar = asyncHandler(async (req, res) => {
  const avtarLocalPath = req.file?.path;

  if (!avtarLocalPath) {
    throw new ApiError(400, "Avatar file is missing");
  }
  const user = await User.findById(req.user?._id);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const oldAvatarUrl = user.avatar;
  const avatar = await uploadOnCloudinary(avtarLocalPath);
  if (!avatar.url) {
    throw new ApiError(400, "Error while uploading on avatar");
  }
  // Delete the old avatar from Cloudinary if it exists
  if (oldAvatarUrl) {
    await deleteFromCloudinary(oldAvatarUrl);
  }
  // Update the user's avatar URL in the database
  user.avatar = avatar.url;
  await user.save();

  // Clean up local file after upload
  fs.unlink(avtarLocalPath, (err) => {
    if (err) {
      console.error("Failed to delete local file:", err);
    }
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        user.select("-password"),
        "User avatar updated successfully"
      )
    );
});


const updateUserCoverImage = asyncHandler(async (req, res) => {
  const CoverImageLocalPath = req.file?.path;

  if (!CoverImageLocalPath) {
    throw new ApiError(400, "Cover Image file is missing");
  }
  const user = await User.findById(req.user?._id);
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  const oldCoverImageUrl = user.coverImage;
  const coverImage = await uploadOnCloudinary(CoverImageLocalPath);
  if (!coverImage.url) {
    throw new ApiError(400, "Error while uploading on avatar");
  }
  if (oldCoverImageUrl) {
    await deleteFromCloudinary(oldCoverImageUrl);
  }
  // Update the user's coverImage URL in the database
  user.coverImage = coverImage.url;
  await user.save();
  // Clean up local file after upload
  fs.unlink(CoverImageLocalPath, (err) => {
    if (err) {
      console.error("Failed to delete local file:", err);
    }
  });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        user.select("-password"),
        "User coverImage updated successfully"
      )
    );
});


const getUserChannelProfile = asyncHandler(async(req,res) => {
const {username} = req.params
if(!username?.trim()) {
  throw new ApiError(400, "Username is missing")
}
const channel =  await User.aggregate([
  {
    $match:{
      username:username?.toLowerCase(),
    }
  },
  {
    $lookup:{
      from:"subscriptions",
      localField:"._id",
      foreignField:"channel",
      as:"subscribers"
    }
  },
  {
    $lookup:{
      from:"subscriptions",
      localField:"._id",
      foreignField:"subscriber",
      as:"subscribedTo"
    }
  },
  {
    $addFields:{
      subscribersCount:{
        $size:"$subscribers"
      },
      channelSubscribedToCount:{
        $size:"$subscribedTo"
      },
      isSubscribed:{
        $cond:{
          if:{$in: [req.user?._id,"$subscribers.subscriber"]},
          then:true,
          else:false
        }
      }
    }
  },
  {
    $project: {
      fullName:1,
      username:1,
      subscribersCount:1,
      channelSubscribedToCount:1,
      isSubscribed:1,
      avatar:1,
      coverImage:1,
      email:1

    }
  }
])
if(!channel?.length){
  throw new ApiError(404, "channel does not exist")
}
return res
.status(200)
.json(
  new ApiResponse(200, channel[0], "User channel fetched successfully")
)
})


const getWatchHistory = asyncHandler(async(req,res) => {
   const user = await User.aggregate([
    {
      $match:{
        _id: new mongoose.Types.ObjectId(req.user._id)
      }
    },
    {
      $lookup:{
        from:"video",
        localField:"watchHistory",
        foreignField:"_id",
        as:"watchHistory",
        pipeline:
        [
          {
          $lookup:{
            from:"users",
            localField:"owner",
            foreignField:"_id",
            as:"owner",
            pipeline:[
              {
                $project:{
                  fullName:1,
                  username:1,
                  avatar:1,
                  coverImage:1
                }
              }
            ]
          }
        },
        {
        $addFields:{
          owner:{
              $first:"owner",
          }
        }
      }
      ]
      }
    }
   ])
   return res
   .status(200)
   .json(
    new ApiResponse(200, user[0].watchHistory, "User watch history fetched successfully")
   )
})

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserCoverImage,
  getUserChannelProfile,
  getWatchHistory
};
